import { AppError } from "./errors.js";
import type { FileChange, OrchestrateResponse } from "../types.js";
import type { TraceEvent } from "./logger.js";

/** HTTP extraoficial: cliente abortó. El JSON del job usa status "cancelled". */
export const CANCELLED_CODE = 499;

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

export function isCancelled(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (isAbortError(err)) return true;
  return err instanceof AppError && err.statusCode === CANCELLED_CODE;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError("Job cancelado", CANCELLED_CODE);
  }
}

export function cancelledResponse(trace: TraceEvent[] = []): OrchestrateResponse {
  const changes: FileChange[] = [];
  return {
    status: "cancelled",
    summary: "Job cancelado",
    changes,
    trace,
    error: "cancelado",
  };
}
