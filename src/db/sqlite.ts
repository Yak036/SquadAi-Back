import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { env } from "../config/env.js";
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

  const existing = d.prepare("SELECT id FROM api_keys WHERE id = ?").get("deepseek");
  if (!existing) {
    d.prepare(
      `INSERT INTO api_keys (id, label, api_key, base_url, updated_at)
       VALUES (@id, @label, @api_key, @base_url, datetime('now'))`,
    ).run({
      id: "deepseek",
      label: "DeepSeek",
      api_key: isUsableKey(env.deepseekApiKey) ? env.deepseekApiKey : "",
      base_url: env.deepseekBaseUrl,
    });
  }
}
