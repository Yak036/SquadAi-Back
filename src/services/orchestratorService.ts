import { planWork, reviewCode } from "../agents/bossAgent.js";
import { addUsage, emptyUsage, formatUsage } from "../agents/llm.js";
import { generateFile } from "../agents/workerAgent.js";
import type { TokenUsage } from "../types.js";
import type {
  AgentPermissions,
  FileChange,
  OrchestrateRequest,
  OrchestrateResponse,
} from "../types.js";
import { AppError } from "../utils/errors.js";
import { cancelledResponse, isCancelled } from "../utils/abort.js";
import { clip, createJobLog, type TraceEvent } from "../utils/logger.js";
import { runChat } from "./chatService.js";
import { getSettings, hasLlmKey } from "./configService.js";
import { FileService } from "./fileService.js";

const DEFAULT_PERMISSIONS: AgentPermissions = {
  writeFiles: true,
  createDirs: true,
  runCommands: false,
};

/**
 * Bucle Jefe → Trabajador → QA → (retry) → disco.
 *
 *   [requirement]
 *        |
 *        v
 *    Boss.plan  ---- archivos[]
 *        |
 *        +--> por cada archivo:
 *               Worker.generate  <---+
 *                     |              |
 *                  Boss.qa ----------+ (approved=false, < maxRetries)
 *                     |
 *                     v approved
 *               FileService.write
 *        |
 *        v
 *   JSON { status, summary, changes, trace }
 */
export type OrchestrateHooks = {
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
};

export async function runOrchestration(
  input: OrchestrateRequest,
  hooks: OrchestrateHooks = {},
): Promise<OrchestrateResponse> {
  if (input.mode === "chat") return runChat(input, hooks);
  const job = createJobLog(hooks.onEvent);
  const settings = getSettings();
  const signal = hooks.signal;
  let jobUsage = emptyUsage();
  const track = (actor: "boss" | "worker" | "qa") => (u: TokenUsage) => {
    jobUsage = addUsage(jobUsage, u);
    job.push(actor, "tokens", formatUsage(u), u);
  };

  if (!hasLlmKey()) {
    throw new AppError("API key del proveedor activo no configurada (usa /connect <id>)", 503);
  }

  const requirement = input.requirement.trim();
  if (!requirement) {
    throw new AppError("requirement es obligatorio", 400);
  }

  const workspaceDir = (input.workspaceDir ?? settings.workspaceDir).trim();
  if (!workspaceDir) {
    throw new AppError("workspaceDir es obligatorio (body o config)", 400);
  }

  const maxRetries = clampRetries(input.maxRetries ?? settings.maxRetries);
  const permissions: AgentPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...input.permissions,
  };

  const files = new FileService(workspaceDir, permissions);
  await files.assertWorkspace();

  if (permissions.runCommands) {
    job.push("system", "aviso", "runCommands=true ignorado en fase 1 (no se ejecutan shells)");
  }

  const tree = await files.listTree();
  if (signal?.aborted) return cancelledResponse(job.events);
  job.push("boss", "captando requerimiento", clip(requirement, 240));
  job.push("boss", "workspace", files.root);
  job.push("boss", "pensando el plan", `modelo ${settings.bossModel}`);

  let plan;
  let reasoning = "";
  try {
    const planned = await planWork({
      requirement,
      tree,
      onUsage: track("boss"),
      ...(signal ? { signal } : {}),
    });
    plan = planned.plan;
    reasoning = planned.reasoning;
  } catch (err) {
    if (isCancelled(err, signal)) {
      job.push("system", "cancelado", "el usuario abortó el plan");
      return cancelledResponse(job.events);
    }
    throw err;
  }

  if (plan.understanding) {
    job.push("boss", "idea captada", plan.understanding);
  }
  if (reasoning) {
    job.push("boss", "razonamiento", clip(reasoning, 400));
  }
  job.push("boss", "plan", plan.summary || "(sin summary)");

  const orderLines = plan.files.map(
    (f, i) => `${i + 1}. [${f.action}] ${f.filepath} — ${clip(f.specification, 140)}`,
  );
  job.push("boss", `orden al worker (${plan.files.length} archivo(s))`, orderLines.join(" | "));
  job.banner("ORDEN AL WORKER", orderLines);

  const changes: FileChange[] = [];
  let result: OrchestrateResponse = {
    status: "success",
    summary: plan.summary || `Se procesaron ${plan.files.length} archivo(s).`,
    changes,
    trace: job.events,
  };

  for (const task of plan.files) {
    files.resolveSafe(task.filepath);

    const exists = await files.exists(task.filepath);
    let existingCode: string | undefined;
    if (exists) {
      existingCode = await files.readText(task.filepath);
    }

    let lastError = "";
    let wrote = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) return cancelledResponse(job.events);
      job.push(
        "worker",
        `generando ${task.filepath}`,
        `intento ${attempt}/${maxRetries} · modelo ${settings.workerModel}`,
      );

      const genArgs: Parameters<typeof generateFile>[0] = {
        requirement,
        filepath: task.filepath,
        specification: task.specification,
      };
      if (existingCode) genArgs.existingCode = existingCode;
      if (lastError) genArgs.feedback = lastError;
      if (signal) genArgs.signal = signal;
      genArgs.onUsage = track("worker");

      let generated;
      try {
        generated = await generateFile(genArgs);
      } catch (err) {
        if (isCancelled(err, signal)) {
          job.push("system", "cancelado", `abortado en ${task.filepath}`);
          return cancelledResponse(job.events);
        }
        lastError = err instanceof Error ? err.message : String(err);
        job.push("worker", "falló", lastError);
        continue;
      }

      job.push("qa", `revisando ${task.filepath}`, `intento ${attempt}/${maxRetries}`);

      let qa;
      try {
        const qaArgs: Parameters<typeof reviewCode>[0] = {
          requirement,
          specification: task.specification,
          generated,
          onUsage: track("qa"),
        };
        if (signal) qaArgs.signal = signal;
        qa = await reviewCode(qaArgs);
      } catch (err) {
        if (isCancelled(err, signal)) {
          job.push("system", "cancelado", `abortado en QA de ${task.filepath}`);
          return cancelledResponse(job.events);
        }
        lastError = err instanceof Error ? err.message : String(err);
        job.push("qa", "falló", lastError);
        continue;
      }

      if (!qa.approved) {
        lastError = qa.feedback || "QA rechazó el archivo sin detalle";
        job.push("qa", `rechazado ${task.filepath}`, clip(lastError, 300));
        continue;
      }

      job.push("qa", `aprobado ${task.filepath}`, "");
      changes.push(await files.writeText(task.filepath, generated.code));
      wrote = true;
      break;
    }

    if (!wrote) {
      result = {
        status: changes.length > 0 ? "partial" : "failed",
        summary: plan.summary,
        changes,
        trace: job.events,
        error: `QA no aprobó ${task.filepath} tras ${maxRetries} intentos: ${lastError}`,
      };
      break;
    }
  }

  result.trace = job.events;
  if (jobUsage.total) result.usage = jobUsage;
  const done =
    result.status === "success"
      ? `${result.changes.length} archivo(s) escrito(s)`
      : result.error || result.summary;
  job.push("system", `tarea finalizada (${result.status})`, done);
  job.banner(`TAREA FINALIZADA (${result.status.toUpperCase()})`, [
    result.summary,
    ...result.changes.map((c) => `${c.action}: ${c.file}`),
    result.error ?? "",
  ].filter(Boolean));

  return result;
}

function clampRetries(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(n)));
}
