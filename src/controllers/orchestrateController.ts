import type { NextFunction, Request, Response } from "express";
import { runOrchestration } from "../services/orchestratorService.js";
import type { OrchestrateRequest } from "../types.js";
import { AppError } from "../utils/errors.js";

export async function postOrchestrate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
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

    const result = await runOrchestration(payload);
    const http = result.status === "success" ? 200 : 422;
    res.status(http).json(result);
  } catch (err) {
    next(err);
  }
}
