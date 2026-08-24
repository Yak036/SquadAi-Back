/**
 * Contratos JSON entre API, Jefe (planner/QA) y Trabajador (codegen).
 * Todo intercambio entre agentes debe caber en estos tipos.
 */

import type { TokenUsage, TraceEvent } from "./utils/logger.js";

export type { TokenUsage };

export type FileAction = "create" | "modify";
export type ChangeAction = "created" | "modified";
export type JobStatus = "success" | "partial" | "failed" | "cancelled";

/** Permisos que el frontend/CLI puede conceder por job. */
export type AgentPermissions = {
  writeFiles: boolean;
  createDirs: boolean;
  /** Fase 1: se acepta el flag pero no se ejecutan shells. */
  runCommands: boolean;
};

export type PlannedFile = {
  filepath: string;
  action: FileAction;
  specification: string;
};

export type PlanResult = {
  /** Qué entendió el Jefe del requerimiento. */
  understanding: string;
  summary: string;
  files: PlannedFile[];
};

export type WorkerFile = {
  filepath: string;
  code: string;
};

export type QaResult = {
  approved: boolean;
  feedback: string;
  filepath: string;
};

export type FileChange = {
  action: ChangeAction;
  file: string;
  path: string;
  /** Contenido anterior; null si el archivo no existía. Para revertir en el CLI. */
  previous?: string | null;
};

export type RuleScope = "global" | "boss" | "worker" | "qa" | "chat";

export type Rule = {
  id: string;
  scope: RuleScope;
  label: string;
  content: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type RuleCreate = {
  scope?: RuleScope;
  label: string;
  content: string;
  priority?: number;
};

export type RulePatch = {
  scope?: RuleScope;
  label?: string;
  content?: string;
  enabled?: boolean;
  priority?: number;
};

export type ActiveRules = {
  global: Rule[];
  scoped: Rule[];
};

export type AgentMode = "squad" | "chat";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type OrchestrateRequest = {
  requirement: string;
  workspaceDir?: string;
  maxRetries?: number;
  permissions?: Partial<AgentPermissions>;
  /** squad = jefe/worker/QA. chat = un solo modelo. Ambos pueden escribir archivos. */
  mode?: AgentMode;
  /** Historial corto para el modo chat. */
  history?: ChatTurn[];
};

export type OrchestrateResponse = {
  status: JobStatus;
  summary: string;
  changes: FileChange[];
  /** Timeline del job para pintarlo en CLI/frontend. */
  trace: TraceEvent[];
  /** Suma de usage de todas las llamadas LLM de este job. */
  usage?: TokenUsage;
  error?: string;
};

export type AppSettings = {
  bossModel: string;
  workerModel: string;
  workspaceDir: string;
  maxRetries: number;
  /** id de api_keys: openai, anthropic, deepinfra, deepseek, o uno custom. */
  activeProvider: string;
};

export type ApiKeyPublic = {
  id: string;
  label: string;
  apiKeySet: boolean;
  apiKeyMasked: string;
  baseUrl: string;
};

export type ConfigPublic = {
  settings: AppSettings;
  keys: ApiKeyPublic[];
};

export type ConfigPatch = {
  settings?: Partial<AppSettings>;
  keys?: Array<{
    id: string;
    label?: string;
    apiKey?: string;
    baseUrl?: string;
  }>;
};

/** Respuesta de estado para health checks. Serializable a JSON. */
export interface StatusResponse {
  ok: boolean;
  message: string;
  checkedAt: string;
  service?: string;
  version?: string;
  database?: "connected" | "disconnected";
  agents?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}
