import { env } from "../config/env.js";
import { getDb } from "../db/sqlite.js";
import type { ApiKeyPublic, AppSettings, ConfigPublic } from "../types.js";
import { AppError } from "../utils/errors.js";
import { isUsableKey, looksMasked, maskSecret } from "../utils/secrets.js";

type SettingRow = { key: string; value: string };
type KeyRow = { id: string; label: string; api_key: string; base_url: string };

const SETTING_KEYS = ["bossModel", "workerModel", "workspaceDir", "maxRetries"] as const;

export function getSettings(): AppSettings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as SettingRow[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const maxRetries = Number(map.get("maxRetries") ?? env.maxRetries);
  return {
    bossModel: map.get("bossModel") || env.bossModel,
    workerModel: map.get("workerModel") || env.workerModel,
    workspaceDir: map.get("workspaceDir") ?? env.workspaceDir,
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 3,
  };
}

export function getApiKeyRow(id: string): KeyRow | undefined {
  return getDb().prepare("SELECT id, label, api_key, base_url FROM api_keys WHERE id = ?").get(id) as
    | KeyRow
    | undefined;
}

export function resolveDeepseekKey(): string {
  const row = getApiKeyRow("deepseek");
  if (row && isUsableKey(row.api_key)) return row.api_key;
  return isUsableKey(env.deepseekApiKey) ? env.deepseekApiKey : "";
}

export function resolveDeepseekBaseUrl(): string {
  const row = getApiKeyRow("deepseek");
  if (row?.base_url.trim()) return row.base_url.trim();
  return env.deepseekBaseUrl;
}

export function hasDeepSeekKey(): boolean {
  return isUsableKey(resolveDeepseekKey());
}

function toPublicKey(row: KeyRow): ApiKeyPublic {
  return {
    id: row.id,
    label: row.label,
    apiKeySet: isUsableKey(row.api_key),
    apiKeyMasked: maskSecret(row.api_key),
    baseUrl: row.base_url,
  };
}

export function getPublicConfig(): ConfigPublic {
  const keys = getDb().prepare("SELECT id, label, api_key, base_url FROM api_keys ORDER BY id").all() as KeyRow[];
  return { settings: getSettings(), keys: keys.map(toPublicKey) };
}

export function patchSettings(partial: Partial<AppSettings>): AppSettings {
  const stmt = getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const current = getSettings();
  const next: AppSettings = { ...current };

  if (typeof partial.bossModel === "string" && partial.bossModel.trim()) {
    next.bossModel = partial.bossModel.trim();
  }
  if (typeof partial.workerModel === "string" && partial.workerModel.trim()) {
    next.workerModel = partial.workerModel.trim();
  }
  if (typeof partial.workspaceDir === "string") {
    next.workspaceDir = partial.workspaceDir.trim();
  }
  if (typeof partial.maxRetries === "number" && Number.isFinite(partial.maxRetries)) {
    next.maxRetries = Math.min(5, Math.max(1, Math.trunc(partial.maxRetries)));
  }

  for (const key of SETTING_KEYS) {
    stmt.run({ key, value: String(next[key]) });
  }
  return next;
}

export function upsertApiKey(input: {
  id: string;
  label?: string;
  apiKey?: string;
  baseUrl?: string;
}): ApiKeyPublic {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) {
    throw new AppError("id de proveedor inválido", 400);
  }

  const existing = getApiKeyRow(id);
  let apiKey = existing?.api_key ?? "";
  if (typeof input.apiKey === "string" && input.apiKey.trim() && !looksMasked(input.apiKey)) {
    apiKey = input.apiKey.trim();
  }

  const label = input.label?.trim() || existing?.label || id;
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : (existing?.base_url ?? "");

  getDb()
    .prepare(
      `INSERT INTO api_keys (id, label, api_key, base_url, updated_at)
       VALUES (@id, @label, @api_key, @base_url, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         api_key = excluded.api_key,
         base_url = excluded.base_url,
         updated_at = excluded.updated_at`,
    )
    .run({ id, label, api_key: apiKey, base_url: baseUrl });

  const row = getApiKeyRow(id);
  if (!row) throw new AppError("No se pudo guardar la API key", 500);
  return toPublicKey(row);
}

export function clearApiKey(id: string): ApiKeyPublic {
  const row = getApiKeyRow(id);
  if (!row) throw new AppError(`Proveedor no encontrado: ${id}`, 404);
  getDb()
    .prepare(`UPDATE api_keys SET api_key = '', updated_at = datetime('now') WHERE id = ?`)
    .run(id);
  return toPublicKey({ ...row, api_key: "" });
}
