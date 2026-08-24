/**
 * Modo chat: un solo modelo. Puede responder texto o escribir archivos
 * si el usuario lo pide. Sin jefe/QA. Pide contexto con glob/read/grep.
 */
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { addUsage, chatTurn, emptyUsage, formatUsage } from "../agents/llm.js";
import type { FileChange, OrchestrateRequest, OrchestrateResponse, TokenUsage } from "../types.js";
import { cancelledResponse, isCancelled } from "../utils/abort.js";
import { AppError } from "../utils/errors.js";
import { parseLlmJson, recoverRawFile } from "../utils/json.js";
import { clip, createJobLog, type TraceEvent } from "../utils/logger.js";
import { FileService } from "./fileService.js";
import { getSettings, hasLlmKey } from "./configService.js";
import { buildRulesBlock, getActiveRules } from "./rulesService.js";
import { runWorkspaceTool, WORKSPACE_TOOLS } from "./workspaceTools.js";

/** Mismo shape que OrchestrateHooks; se declara aquí para no ciclar con el orquestador. */
type ChatHooks = {
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};

const MAX_TOOL_ROUNDS = 8;

const CHAT_SYSTEM = `Eres un asistente de código en un workspace local (modo chat, un solo modelo).
No recibes el árbol de archivos. Si necesitás ver el repo, usá las tools:
- glob: listar paths (ej. *.ts)
- read: leer un archivo (paginado)
- grep: buscar un regex

Cuando termines, respondé ÚNICAMENTE un JSON (sin markdown alrededor):
{
  "reply": "respuesta al usuario",
  "files": [
    { "filepath": "ruta/relativa.ts", "action": "create" | "modify", "code": "contenido completo del archivo" }
  ]
}

Reglas:
- Charla o preguntas sin tocar disco: files = []
- Antes de editar un archivo existente, leelo con read. No inventes el contenido.
- Crear archivo: files con el contenido COMPLETO
- filepath relativa al workspace, nunca absoluta ni con ..
- No toques .env, *.pem ni credentials.json
- Los fences \`\`\` van DENTRO de reply o code; el JSON exterior no lleva backticks`;

type ChatFile = { filepath: string; action: "create" | "modify"; code: string };

type ChatPayload = {
  reply: string;
  files: ChatFile[];
};

function asChatPayload(raw: unknown, fallbackText: string): ChatPayload {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const reply = typeof o.reply === "string" ? o.reply : fallbackText;
    const filesIn = Array.isArray(o.files) ? o.files : [];
    const files: ChatFile[] = [];
    for (const item of filesIn) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const filepath = String(row.filepath ?? "").trim();
      const code = typeof row.code === "string" ? row.code : "";
      if (!filepath || !code) continue;
      files.push({
        filepath,
        action: row.action === "modify" ? "modify" : "create",
        code,
      });
    }
    return { reply: reply || fallbackText, files };
  }
  return { reply: fallbackText, files: [] };
}

export async function runChat(
  input: OrchestrateRequest,
  hooks: ChatHooks = {},
): Promise<OrchestrateResponse> {
  const job = createJobLog(hooks.onEvent);
  const settings = getSettings();
  const signal = hooks.signal;
  let jobUsage = emptyUsage();
  const track = (u: TokenUsage): void => {
    jobUsage = addUsage(jobUsage, u);
    job.push("chat", "tokens", formatUsage(u), u);
  };

  if (!hasLlmKey()) {
    throw new AppError("API key del proveedor activo no configurada (usa /connect <id>)", 503);
  }

  const requirement = input.requirement.trim();
  if (!requirement) throw new AppError("requirement es obligatorio", 400);

  const workspaceDir = (input.workspaceDir ?? settings.workspaceDir).trim();
  if (!workspaceDir) throw new AppError("workspaceDir es obligatorio (body o config)", 400);

  const permissions = {
    writeFiles: true,
    createDirs: true,
    runCommands: false,
    ...input.permissions,
  };
  const files = new FileService(workspaceDir, permissions);
  await files.assertWorkspace();

  if (signal?.aborted) return cancelledResponse(job.events);

  job.push("chat", "captando mensaje", clip(requirement, 240));
  job.push("chat", "workspace", files.root);
  job.push("chat", "pensando", `modelo ${settings.workerModel}`);

  // ponytail: el árbol iba acá y inflaba cada "hola". Squad sigue mandándolo al jefe.
  const rulesBlock = buildRulesBlock(getActiveRules("chat"));
  const systemPrompt = CHAT_SYSTEM + rulesBlock;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
  ];
  for (const turn of input.history ?? []) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const content = turn.content.trim();
    if (!content) continue;
    messages.push({ role: turn.role, content });
  }
  messages.push({
    role: "user",
    content: `WORKSPACE: ${files.root}\n\nMENSAJE:\n${requirement}`,
  });

  let content = "";
  try {
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      if (signal?.aborted) return cancelledResponse(job.events);
      const turnArgs: Parameters<typeof chatTurn>[0] = {
        model: settings.workerModel,
        messages,
        tools: WORKSPACE_TOOLS,
      };
      if (signal) turnArgs.signal = signal;
      turnArgs.onUsage = track;
      const turn = await chatTurn(turnArgs);

      if (turn.toolCalls.length) {
        messages.push({
          role: "assistant",
          content: turn.content || null,
          tool_calls: turn.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        for (const call of turn.toolCalls) {
          if (signal?.aborted) return cancelledResponse(job.events);
          job.push("chat", `${call.name}`, clip(call.arguments, 160));
          let output: string;
          try {
            output = await runWorkspaceTool(files, call.name, call.arguments);
          } catch (err) {
            output = err instanceof Error ? err.message : String(err);
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
        continue;
      }

      content = turn.content;
      break;
    }
  } catch (err) {
    if (isCancelled(err, signal)) {
      job.push("system", "cancelado", "el usuario abortó el chat");
      return cancelledResponse(job.events);
    }
    throw err;
  }

  if (!content.trim()) {
    content = JSON.stringify({
      reply: "Paré tras demasiadas lecturas. Pedime de nuevo o más específico.",
      files: [],
    });
  }

  let parsed: ChatPayload;
  try {
    parsed = asChatPayload(parseLlmJson(content), content);
  } catch {
    const recovered = recoverRawFile(content);
    parsed = { reply: recovered ?? content, files: [] };
  }

  job.push("chat", "respuesta", clip(parsed.reply, 240));

  const changes: FileChange[] = [];
  for (const file of parsed.files) {
    if (signal?.aborted) return cancelledResponse(job.events);
    try {
      files.resolveSafe(file.filepath);
      job.push("chat", `escribiendo ${file.filepath}`, file.action);
      changes.push(await files.writeText(file.filepath, file.code));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.push("chat", `falló ${file.filepath}`, msg);
    }
  }

  const wroteAll = changes.length === parsed.files.length;
  const status = parsed.files.length === 0 || wroteAll ? "success" : changes.length > 0 ? "partial" : "failed";
  const summary = parsed.reply || (changes.length ? `Se escribieron ${changes.length} archivo(s).` : "Sin cambios");

  job.push("system", `tarea finalizada (${status})`, `${changes.length} archivo(s)`);
  const out: OrchestrateResponse = { status, summary, changes, trace: job.events };
  if (jobUsage.total) out.usage = jobUsage;
  return out;
}
