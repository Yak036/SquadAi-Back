import type { NextFunction, Request, Response } from "express";
import { runOrchestration } from "../services/orchestratorService.js";
import type { AgentMode, ChatTurn, OrchestrateRequest, OrchestrateResponse } from "../types.js";
import { cancelledResponse, isCancelled } from "../utils/abort.js";
import { AppError } from "../utils/errors.js";
import type { TraceEvent } from "../utils/logger.js";

function parseBody(req: Request): OrchestrateRequest {
  const body = req.body as OrchestrateRequest | undefined;
  if (!body || typeof body !== "object") {
    throw new AppError("Body JSON requerido", 400);
  }
  if (typeof body.requirement !== "string") {
    throw new AppError("requirement debe ser string", 400);
  }

  const payload: OrchestrateRequest = { requirement: body.requirement };
  if (typeof body.workspaceDir === "string") payload.workspaceDir = body.workspaceDir;
  if (typeof body.maxRetries === "number") payload.maxRetries = body.maxRetries;
  if (body.permissions && typeof body.permissions === "object") {
    payload.permissions = body.permissions;
  }
  const mode = parseMode(body.mode);
  if (mode) payload.mode = mode;
  const history = parseHistory(body.history);
  if (history.length) payload.history = history;
  return payload;
}

function parseMode(raw: unknown): AgentMode | undefined {
  if (raw === "chat" || raw === "squad") return raw;
  return undefined;
}

/** ponytail: tope 16 turnos; el modelo no necesita toda la sesión. */
function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.role !== "user" && row.role !== "assistant") continue;
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!content) continue;
    out.push({ role: row.role, content });
  }
  return out.slice(-16);
}

/**
 * Solo aborta si el CLIENTE cortó la conexión, no cuando el body del POST
 * ya se leyó (IncomingMessage 'close' dispara en ese momento y mataba el job).
 */
function bindAbort(_req: Request, res: Response): AbortController {
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });
  return ac;
}

export async function postOrchestrate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payload = parseBody(req);
    const ac = bindAbort(req, res);
    const result = await runOrchestration(payload, { signal: ac.signal });
    const http = result.status === "success" ? 200 : result.status === "cancelled" ? 200 : 422;
    res.status(http).json(result);
  } catch (err) {
    next(err);
  }
}

type StreamFrame =
  | { type: "trace"; event: TraceEvent }
  | { type: "done"; result: OrchestrateResponse }
  | { type: "error"; message: string };

/**
 * POST /api/orchestrate/stream — SSE.
 * Cada evento (squad o chat) sale en caliente; al final un frame `done`.
 */
export async function postOrchestrateStream(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let payload: OrchestrateRequest;
  try {
    payload = parseBody(req);
  } catch (err) {
    next(err);
    return;
  }

  const ac = bindAbort(req, res);
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (frame: StreamFrame): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  };

  try {
    const result = await runOrchestration(payload, {
      signal: ac.signal,
      onEvent: (event) => send({ type: "trace", event }),
    });
    send({ type: "done", result });
  } catch (err) {
    if (isCancelled(err, ac.signal)) {
      send({ type: "done", result: cancelledResponse() });
    } else {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "error", message });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
