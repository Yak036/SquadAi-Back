import "dotenv/config";

/**
 * Lee y valida variables de entorno. El server puede arrancar sin API key
 * (healthcheck), pero el orquestador fallará si falta.
 */
function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

export const env = {
  port: readNumber("PORT", 4000),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
  // El SDK de OpenAI concatena /chat/completions sobre este baseURL.
  deepseekBaseUrl: readString("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
  bossModel: readString("BOSS_MODEL", "deepseek-reasoner"),
  workerModel: readString("WORKER_MODEL", "deepseek-chat"),
  workspaceDir: process.env.WORKSPACE_DIR?.trim() ?? "",
  maxRetries: readNumber("MAX_RETRIES", 3),
  /** Semilla del proveedor activo; después vive en SQLite. */
  activeProvider: readString("ACTIVE_PROVIDER", "deepseek"),
};

export function hasDeepSeekKey(): boolean {
  return Boolean(env.deepseekApiKey) && !env.deepseekApiKey.includes("tu_api_key");
}
