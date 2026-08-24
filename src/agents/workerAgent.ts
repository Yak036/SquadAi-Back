import { getSettings } from "../services/configService.js";
import { buildRulesBlock, getActiveRules } from "../services/rulesService.js";
import type { WorkerFile } from "../types.js";
import { AppError } from "../utils/errors.js";
import { parseLlmJson, recoverRawFile } from "../utils/json.js";
import { log } from "../utils/logger.js";
import { chatText } from "./llm.js";

const WORKER_SYSTEM = `Eres el Trabajador: generas el contenido COMPLETO de un archivo.
Responde ÚNICAMENTE un JSON (sin markdown, sin backticks) con esta forma exacta:
{
  "filepath": "ruta/relativa.ts",
  "code": "// contenido completo del archivo"
}

Reglas:
- code es el archivo entero, no un diff
- Escapa bien saltos de línea y comillas dentro de code (JSON válido)
- Si el archivo es markdown, los fences \`\`\`bash / \`\`\`ts van DENTRO de code como texto. El JSON exterior NUNCA lleva backticks.
- No inventes dependencias que no estén en la spec
- Si hay feedback de QA, corrige exactamente eso y reescribe el archivo completo`;

function asWorkerFile(raw: unknown): WorkerFile {
  if (!raw || typeof raw !== "object") throw new AppError("Salida del trabajador inválida", 502);
  const o = raw as Record<string, unknown>;
  const filepath = String(o.filepath ?? "").trim();
  const code = typeof o.code === "string" ? o.code : "";
  if (!filepath || !code) {
    throw new AppError("El trabajador no devolvió filepath/code", 502);
  }
  return { filepath, code };
}

export async function generateFile(input: {
  requirement: string;
  filepath: string;
  specification: string;
  existingCode?: string;
  feedback?: string;
  signal?: AbortSignal;
  onUsage?: Parameters<typeof chatText>[0]["onUsage"];
}): Promise<WorkerFile> {
  const parts = [
    `REQUERIMIENTO:\n${input.requirement}`,
    `FILEPATH OBJETIVO:\n${input.filepath}`,
    `ESPECIFICACIÓN:\n${input.specification}`,
  ];
  if (input.existingCode) {
    parts.push(`CÓDIGO ACTUAL DEL ARCHIVO:\n${input.existingCode}`);
  }
  if (input.feedback) {
    parts.push(`FEEDBACK DE QA (corrige esto):\n${input.feedback}`);
  }

  const rulesBlock = buildRulesBlock(getActiveRules("worker"));
  const systemPrompt = WORKER_SYSTEM + rulesBlock;

  const chat: Parameters<typeof chatText>[0] = {
    model: getSettings().workerModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: parts.join("\n\n") },
    ],
  };
  if (input.signal) chat.signal = input.signal;
  if (input.onUsage) chat.onUsage = input.onUsage;
  const { content } = await chatText(chat);

  let raw: unknown;
  try {
    raw = parseLlmJson(content);
  } catch {
    // ponytail: DeepSeek a veces tira el .md/.ts crudo en vez del envelope JSON
    const recovered = recoverRawFile(content);
    if (recovered) {
      log.warn("worker: JSON inválido, usando cuerpo crudo para", input.filepath);
      return { filepath: input.filepath, code: recovered };
    }
    throw new AppError(`JSON inválido del LLM: ${content.trim().slice(0, 240)}`, 502);
  }

  const file = asWorkerFile(raw);
  // El trabajador a veces cambia el path; nos quedamos con el pedido por el plan.
  return { filepath: input.filepath, code: file.code };
}
