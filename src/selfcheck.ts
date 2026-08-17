/**
 * Chequeo mínimo (sin frameworks): parser JSON, path traversal, mask de keys y SQLite.
 * Corre con: npm run check
 */
import assert from "node:assert/strict";
import { cancelledResponse, isCancelled, throwIfAborted } from "./utils/abort.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initDb } from "./db/sqlite.js";
import { FileService, globToRegExp } from "./services/fileService.js";
import { getPublicConfig, upsertApiKey } from "./services/configService.js";
import { extractJsonSlice, parseLlmJson, recoverRawFile } from "./utils/json.js";
import { looksMasked, maskSecret } from "./utils/secrets.js";

const fenced = '```json\n{"filepath":"a.ts","code":"ok"}\n```';
assert.deepEqual(parseLlmJson(fenced), { filepath: "a.ts", code: "ok" });

const prose = 'Listo.\n{"approved":true,"feedback":"","filepath":"x.ts"}\nFin';
assert.equal(parseLlmJson<{ approved: boolean }>(prose).approved, true);

const sliced = extractJsonSlice("foo {\"a\":1} bar");
assert.equal(sliced, '{"a":1}');

assert.throws(() => parseLlmJson("no json here"), /JSON inválido/);

const readmeCode = "# SquadAi-Back\n\n```bash\ngit clone <repo-url>\ncd SquadAi-Back\nnpm install\n```\n";
const readmeJson = JSON.stringify({ filepath: "SquadAi-Back/README.md", code: readmeCode });
assert.equal(parseLlmJson<{ filepath: string }>(readmeJson).filepath, "SquadAi-Back/README.md");
assert.equal(parseLlmJson<{ code: string }>(readmeJson).code.includes("```bash"), true);

const fencedReadme = "```json\n" + readmeJson + "\n```";
assert.equal(parseLlmJson<{ filepath: string }>(fencedReadme).filepath, "SquadAi-Back/README.md");

const withBraces = '{"filepath":"a.md","code":"use { and } here"}';
assert.equal(extractJsonSlice("nota " + withBraces + " fin"), withBraces);

const rawMd = "# Hola\n\n```bash\ngit clone x\n```\n";
assert.equal(recoverRawFile(rawMd)?.includes("git clone"), true);
assert.equal(recoverRawFile(readmeJson), null);

assert.equal(maskSecret("sk-abcdefghijklmnop"), "sk-••••mnop");
assert.equal(looksMasked("sk-••••mnop"), true);

assert.equal(globToRegExp("*.ts").test("hello.ts"), true);
assert.equal(globToRegExp("*.ts").test("src/hello.ts"), true);
assert.equal(globToRegExp("*.ts").test("readme.md"), false);
assert.equal(globToRegExp("src/*.ts").test("src/hello.ts"), true);
assert.equal(globToRegExp("src/*.ts").test("lib/hello.ts"), false);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squad-"));
process.env.SQUAD_DB_PATH = path.join(tmp, "cfg.sqlite");
initDb();

const saved = upsertApiKey({
  id: "deepseek",
  apiKey: "sk-test-clave-real-1234",
  baseUrl: "https://api.deepseek.com",
  label: "DeepSeek",
});
assert.equal(saved.apiKeySet, true);
assert.equal(saved.apiKeyMasked.includes("1234"), true);
assert.equal(getPublicConfig().keys[0]?.apiKeyMasked.includes("sk-"), true);

const files = new FileService(tmp, { writeFiles: true, createDirs: true, runCommands: false });

const ok = files.resolveSafe("src/app.ts");
assert.ok(ok.startsWith(tmp));

assert.throws(() => files.resolveSafe("../etc/passwd"), /Path traversal/);
assert.throws(() => files.resolveSafe("/etc/passwd"), /Path traversal/);
assert.throws(() => files.resolveSafe(".env"), /protegido/);

await files.writeText("src/hello.ts", "export const n = 1;\n");
assert.equal(await files.readText("src/hello.ts"), "export const n = 1;\n");
const modified = await files.writeText("src/hello.ts", "export const n = 2;\n");
assert.equal(modified.action, "modified");
assert.equal(modified.previous, "export const n = 1;\n");

await files.writeText("src/app.ts", "export const app = 2;\n");
await files.writeText("readme.md", "# hola\n");
const globbed = await files.glob("*.ts");
assert.match(globbed, /src\/hello\.ts/);
assert.match(globbed, /src\/app\.ts/);
assert.equal(globbed.includes("readme.md"), false);

const page = await files.readSlice("src/hello.ts", 1, 10);
assert.match(page, /^1: export const n = 2;/);

const grepped = await files.grep("export const n", "*.ts");
assert.match(grepped, /src\/hello\.ts:1:/);

try {
  await files.readSlice("../etc/passwd");
  assert.fail("debía bloquear traversal");
} catch (err) {
  assert.match(err instanceof Error ? err.message : "", /Path traversal/);
}

const live = new AbortController();
throwIfAborted(live.signal);
live.abort();
assert.throws(() => throwIfAborted(live.signal), /cancelado/);
assert.equal(isCancelled(new Error("AbortError"), live.signal), true);
assert.equal(cancelledResponse().status, "cancelled");

console.log("selfcheck ok");
