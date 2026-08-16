/**
 * Contratos JSON entre API, Jefe (planner/QA) y Trabajador (codegen).
 * Todo intercambio entre agentes debe caber en estos tipos.
 */

export type FileAction = "create" | "modify";
export type ChangeAction = "created" | "modified";
export type JobStatus = "success" | "partial" | "failed";

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
};

export type OrchestrateRequest = {
  requirement: string;
  workspaceDir?: string;
  maxRetries?: number;
  permissions?: Partial<AgentPermissions>;
};

export type OrchestrateResponse = {
  status: JobStatus;
  summary: string;
  changes: FileChange[];
  error?: string;
};
