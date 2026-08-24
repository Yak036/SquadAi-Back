import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { env } from "../config/env.js";
import { PROVIDER_PRESETS } from "../config/providers.js";
import { isUsableKey } from "../utils/secrets.js";

type SqliteDb = InstanceType<typeof Database>;

let db: SqliteDb | undefined;

function defaultDbPath(): string {
  const fromEnv = process.env.SQUAD_DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  // dist/db/sqlite.js → raíz del repo
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data/squad.sqlite");
}

export function initDb(dbPath = defaultDbPath()): SqliteDb {
  if (db) return db;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedFromEnv(db);
  return db;
}

export function getDb(): SqliteDb {
  return db ?? initDb();
}

function migrate(d: SqliteDb): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'global',
      label TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Solo inserta si la fila no existe: el frontend/SQLite gana después del primer save. */
function seedFromEnv(d: SqliteDb): void {
  const insertSetting = d.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at)
     VALUES (@key, @value, datetime('now'))`,
  );
  insertSetting.run({ key: "bossModel", value: env.bossModel });
  insertSetting.run({ key: "workerModel", value: env.workerModel });
  insertSetting.run({ key: "workspaceDir", value: env.workspaceDir });
  insertSetting.run({ key: "maxRetries", value: String(env.maxRetries) });
  insertSetting.run({ key: "activeProvider", value: env.activeProvider });

  const insertKey = d.prepare(
    `INSERT OR IGNORE INTO api_keys (id, label, api_key, base_url, updated_at)
     VALUES (@id, @label, @api_key, @base_url, datetime('now'))`,
  );
  for (const p of PROVIDER_PRESETS) {
    const fromEnv = p.id === "deepseek" && isUsableKey(env.deepseekApiKey) ? env.deepseekApiKey : "";
    insertKey.run({
      id: p.id,
      label: p.label,
      api_key: fromEnv,
      base_url: p.id === "deepseek" ? env.deepseekBaseUrl : p.baseUrl,
    });
  }
}
