import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config/env.js";
import {
  deleteKey,
  getConfig,
  listKeys,
  putConfig,
  putKey,
} from "./controllers/configController.js";
import { postOrchestrate, postOrchestrateStream } from "./controllers/orchestrateController.js";
import {
  listRules,
  listActiveRules,
  getRule,
  postRule,
  putRule,
  deleteRuleHandler,
} from "./controllers/rulesController.js";
import { initDb } from "./db/sqlite.js";
import { getSettings, hasLlmKey } from "./services/configService.js";
import { AppError } from "./utils/errors.js";
import { log } from "./utils/logger.js";

initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  const llm = hasLlmKey();
  const provider = getSettings().activeProvider;
  // deepseek = alias de llm: el Hud viejo todavía lo lee.
  res.json({ ok: true, llm, provider, deepseek: llm });
});

app.get("/api/config", getConfig);
app.put("/api/config", putConfig);
app.get("/api/config/keys", listKeys);
app.put("/api/config/keys/:id", putKey);
app.delete("/api/config/keys/:id", deleteKey);

app.post("/api/orchestrate", postOrchestrate);
app.post("/api/orchestrate/stream", postOrchestrateStream);

app.get("/api/rules", listRules);
app.get("/api/rules/active", listActiveRules);
app.get("/api/rules/:id", getRule);
app.post("/api/rules", postRule);
app.put("/api/rules/:id", putRule);
app.delete("/api/rules/:id", deleteRuleHandler);

app.use((_req, res) => {
  res.status(404).json({ status: "failed", summary: "Ruta no encontrada", changes: [], trace: [] });
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
    trace: [],
    error: message,
  });
});

app.listen(env.port, () => {
  log.info(`API en http://localhost:${env.port}`);
  if (!hasLlmKey()) log.warn(`API key pendiente: PUT /api/config/keys/${getSettings().activeProvider}`);
});
