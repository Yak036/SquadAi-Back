import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { env, hasDeepSeekKey } from "./config/env.js";
import { postOrchestrate } from "./controllers/orchestrateController.js";
import { AppError } from "./utils/errors.js";
import { log } from "./utils/logger.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, deepseek: hasDeepSeekKey() });
});

app.post("/api/orchestrate", postOrchestrate);

app.use((_req, res) => {
  res.status(404).json({ status: "failed", summary: "Ruta no encontrada", changes: [] });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const appErr = err instanceof AppError ? err : null;
  const status = appErr?.statusCode ?? 500;
  const message = appErr?.message ?? (err instanceof Error ? err.message : "Error interno");
  if (status >= 500) log.error(err);
  res.status(status).json({
    status: "failed",
    summary: message,
    changes: [],
    error: message,
  });
});

app.listen(env.port, () => {
  log.info(`API en http://localhost:${env.port}`);
  if (!hasDeepSeekKey()) log.warn("DEEPSEEK_API_KEY pendiente en .env");
});
