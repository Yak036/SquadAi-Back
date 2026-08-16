import { planWork, reviewCode } from "../agents/bossAgent.js";
import { generateFile } from "../agents/workerAgent.js";
import { env } from "../config/env.js";
import type {
  AgentPermissions,
  FileChange,
  OrchestrateRequest,
  OrchestrateResponse,
} from "../types.js";
import { AppError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
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
 *   JSON { status, summary, changes }
 */
export async function runOrchestration(input: OrchestrateRequest): Promise<OrchestrateResponse> {
  if (!env.deepseekApiKey || env.deepseekApiKey.includes("tu_api_key")) {
    throw new AppError("DEEPSEEK_API_KEY no configurada", 503);
  }

  const requirement = input.requirement.trim();
  if (!requirement) {
    throw new AppError("requirement es obligatorio", 400);
  }

  const workspaceDir = (input.workspaceDir ?? env.workspaceDir).trim();
  if (!workspaceDir) {
    throw new AppError("workspaceDir es obligatorio (body o WORKSPACE_DIR)", 400);
  }

  const maxRetries = clampRetries(input.maxRetries ?? env.maxRetries);
  const permissions: AgentPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...input.permissions,
  };

  const files = new FileService(workspaceDir, permissions);
  await files.assertWorkspace();

  if (permissions.runCommands) {
    log.warn("runCommands=true ignorado en fase 1 (no se ejecutan shells)");
  }

  const tree = await files.listTree();
  log.info("Planificando en", files.root);

  const plan = await planWork({ requirement, tree });
  const changes: FileChange[] = [];

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
      log.info(`Archivo ${task.filepath} intento ${attempt}/${maxRetries}`);

      const genArgs: Parameters<typeof generateFile>[0] = {
        requirement,
        filepath: task.filepath,
        specification: task.specification,
      };
      if (existingCode) genArgs.existingCode = existingCode;
      if (lastError) genArgs.feedback = lastError;

      let generated;
      try {
        generated = await generateFile(genArgs);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn("Trabajador falló:", lastError);
        continue;
      }

      let qa;
      try {
        qa = await reviewCode({
          requirement,
          specification: task.specification,
          generated,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn("QA falló:", lastError);
        continue;
      }

      if (!qa.approved) {
        lastError = qa.feedback || "QA rechazó el archivo sin detalle";
        log.warn("QA rechazó", task.filepath, lastError);
        continue;
      }

      changes.push(await files.writeText(task.filepath, generated.code));
      wrote = true;
      break;
    }

    if (!wrote) {
      return {
        status: changes.length > 0 ? "partial" : "failed",
        summary: plan.summary,
        changes,
        error: `QA no aprobó ${task.filepath} tras ${maxRetries} intentos: ${lastError}`,
      };
    }
  }

  return {
    status: "success",
    summary: plan.summary || `Se procesaron ${changes.length} archivo(s).`,
    changes,
  };
}

function clampRetries(n: number): number {
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(n)));
}
