/**
 * Chequeo mínimo (sin frameworks): parser JSON del LLM + path traversal.
 * Corre con: npm run check
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileService } from "./services/fileService.js";
import { extractJsonSlice, parseLlmJson } from "./utils/json.js";

const fenced = '```json\n{"filepath":"a.ts","code":"ok"}\n```';
assert.deepEqual(parseLlmJson(fenced), { filepath: "a.ts", code: "ok" });

const prose = 'Listo.\n{"approved":true,"feedback":"","filepath":"x.ts"}\nFin';
assert.equal(parseLlmJson<{ approved: boolean }>(prose).approved, true);

const sliced = extractJsonSlice("foo {\"a\":1} bar");
assert.equal(sliced, '{"a":1}');

assert.throws(() => parseLlmJson("no json here"), /JSON inválido/);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "squad-"));
const files = new FileService(tmp, { writeFiles: true, createDirs: true, runCommands: false });

const ok = files.resolveSafe("src/app.ts");
assert.ok(ok.startsWith(tmp));

assert.throws(() => files.resolveSafe("../etc/passwd"), /Path traversal/);
assert.throws(() => files.resolveSafe("/etc/passwd"), /Path traversal/);
assert.throws(() => files.resolveSafe(".env"), /protegido/);

await files.writeText("src/hello.ts", "export const n = 1;\n");
assert.equal(await files.readText("src/hello.ts"), "export const n = 1;\n");

console.log("selfcheck ok");
