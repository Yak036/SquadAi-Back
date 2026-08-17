import fs from "node:fs/promises";
import path from "node:path";
import type { AgentPermissions, ChangeAction, FileChange } from "../types.js";
import { AppError } from "../utils/errors.js";

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  ".turbo",
]);

const SECRET_NAME = /^(?:\.env(?:\..*)?|credentials\.json|.*\.pem)$/i;
const MAX_TREE_ENTRIES = 200;
const MAX_FILE_BYTES = 80_000;
const MAX_WALK_FILES = 2_000;
const MAX_GLOB_HITS = 100;
const MAX_GREP_HITS = 100;
const MAX_READ_LINES = 2_000;
const MAX_READ_BYTES = 50 * 1024;
const MAX_LINE_CHARS = 2_000;

/**
 * I/O acotado al workspace elegido por el usuario.
 * Bloquea path traversal (`../`), absolutos fuera del root, null bytes y secretos.
 */
export class FileService {
  readonly root: string;
  readonly permissions: AgentPermissions;

  constructor(workspaceDir: string, permissions: AgentPermissions) {
    this.root = path.resolve(workspaceDir);
    this.permissions = permissions;
  }

  async assertWorkspace(): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(this.root);
    } catch {
      throw new AppError(`Workspace no existe: ${this.root}`, 400);
    }
    if (!stat.isDirectory()) {
      throw new AppError(`Workspace no es un directorio: ${this.root}`, 400);
    }
  }

  /**
   * Resuelve una ruta de agente a absoluta y garantiza que queda DENTRO del root.
   * Acepta relativa (`src/a.ts`) o absoluta si apunta al workspace.
   */
  resolveSafe(inputPath: string): string {
    if (!inputPath || !inputPath.trim()) {
      throw new AppError("Ruta de archivo vacía", 400);
    }
    if (inputPath.includes("\0")) {
      throw new AppError("Ruta inválida (null byte)", 400);
    }

    const target = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.root, inputPath);

    const rel = path.relative(this.root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new AppError(`Path traversal bloqueado: ${inputPath}`, 403);
    }

    const base = path.basename(target);
    if (SECRET_NAME.test(base)) {
      throw new AppError(`Archivo protegido, no se toca: ${rel || base}`, 403);
    }

    return target;
  }

  toRelative(absolutePath: string): string {
    return path.relative(this.root, absolutePath) || path.basename(absolutePath);
  }

  async exists(inputPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolveSafe(inputPath));
      return true;
    } catch {
      return false;
    }
  }

  async readText(inputPath: string): Promise<string> {
    const abs = this.resolveSafe(inputPath);
    const buf = await fs.readFile(abs);
    if (buf.byteLength > MAX_FILE_BYTES) {
      return buf.subarray(0, MAX_FILE_BYTES).toString("utf8") + "\n/* [truncado] */\n";
    }
    return buf.toString("utf8");
  }

  async writeText(inputPath: string, code: string): Promise<FileChange> {
    if (!this.permissions.writeFiles) {
      throw new AppError("Sin permiso para escribir archivos", 403);
    }

    const abs = this.resolveSafe(inputPath);
    const already = await this.exists(inputPath);
    let previous: string | null = null;
    if (already) {
      const buf = await fs.readFile(abs);
      previous = buf.byteLength > 256_000 ? null : buf.toString("utf8");
    }
    const dir = path.dirname(abs);

    if (dir !== this.root) {
      const dirExists = await fs
        .access(dir)
        .then(() => true)
        .catch(() => false);
      if (!dirExists) {
        if (!this.permissions.createDirs) {
          throw new AppError(`Sin permiso para crear carpetas: ${path.relative(this.root, dir)}`, 403);
        }
        await fs.mkdir(dir, { recursive: true });
      }
    }

    await fs.writeFile(abs, code, "utf8");
    const action: ChangeAction = already ? "modified" : "created";
    return { action, file: this.toRelative(abs), path: abs, previous };
  }

  /** Árbol plano para darle contexto al Jefe (sin node_modules/.git/secretos). */
  async listTree(): Promise<string> {
    const names: string[] = [];
    await this.walk(this.root, names);
    if (names.length === 0) return "(workspace vacío)";
    const extra = names.length >= MAX_TREE_ENTRIES ? `\n… (${names.length}+ recortado)` : "";
    return names.join("\n") + extra;
  }

  /**
   * Paths relativas que matchean un glob. `*.ts` también pega en subcarpetas.
   * Tope 100 hits; no entra a node_modules/.git/dist.
   */
  async glob(pattern: string): Promise<string> {
    const files: string[] = [];
    await this.walkFiles(this.root, files);
    const re = globToRegExp(pattern);
    const hits: string[] = [];
    let extra = 0;
    for (const rel of files) {
      if (!re.test(rel)) continue;
      if (hits.length < MAX_GLOB_HITS) hits.push(rel);
      else extra += 1;
    }
    if (!hits.length) return "(sin matches)";
    const tail = extra ? `\n… (${extra} más, recortado)` : "";
    return hits.join("\n") + tail;
  }

  /**
   * Lectura paginada para el modelo: líneas numeradas, 50 KB / 2000 líneas.
   */
  async readSlice(inputPath: string, offset = 1, limit = MAX_READ_LINES): Promise<string> {
    const abs = this.resolveSafe(inputPath);
    const buf = await fs.readFile(abs);
    const lines = buf.toString("utf8").split("\n");
    const start = Math.max(0, Math.trunc(offset) - 1);
    const take = Math.min(MAX_READ_LINES, Math.max(1, Math.trunc(limit) || MAX_READ_LINES));
    if (start >= lines.length) {
      return `(offset ${start + 1} fuera de rango, el archivo tiene ${lines.length} líneas)`;
    }

    const out: string[] = [];
    let bytes = 0;
    let cut = false;
    for (let i = 0; i < take; i++) {
      const idx = start + i;
      if (idx >= lines.length) break;
      let body = lines[idx] ?? "";
      if (body.length > MAX_LINE_CHARS) body = body.slice(0, MAX_LINE_CHARS) + "…";
      const row = `${idx + 1}: ${body}`;
      const size = Buffer.byteLength(row, "utf8") + 1;
      if (bytes + size > MAX_READ_BYTES) {
        cut = true;
        break;
      }
      out.push(row);
      bytes += size;
    }

    const last = start + out.length;
    if (cut) out.push(`… cortado a 50KB. Seguí con offset=${last + 1}`);
    else if (last < lines.length) out.push(`… hay más. Seguí con offset=${last + 1}`);
    return out.join("\n");
  }

  /**
   * Busca un regex en el workspace. include es glob opcional (ej. *.ts).
   */
  async grep(pattern: string, include?: string): Promise<string> {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      return "regex inválida";
    }
    const files: string[] = [];
    await this.walkFiles(this.root, files);
    const filter = include?.trim() ? globToRegExp(include) : null;
    const hits: string[] = [];

    for (const rel of files) {
      if (filter && !filter.test(rel)) continue;
      let text: string;
      try {
        const abs = path.join(this.root, rel);
        const st = await fs.stat(abs);
        if (st.size > MAX_FILE_BYTES) continue;
        text = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      const rows = text.split("\n");
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i] ?? "";
        if (!re.test(line)) continue;
        const clipped = line.length > 200 ? line.slice(0, 200) + "…" : line;
        hits.push(`${rel}:${i + 1}:${clipped}`);
        if (hits.length >= MAX_GREP_HITS) {
          return hits.join("\n") + "\n… recortado";
        }
      }
    }
    return hits.length ? hits.join("\n") : "(sin matches)";
  }

  private async walkFiles(dir: string, out: string[]): Promise<void> {
    if (out.length >= MAX_WALK_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_WALK_FILES) return;
      if (IGNORED_DIR_NAMES.has(entry.name) || SECRET_NAME.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkFiles(abs, out);
        continue;
      }
      if (entry.isFile()) out.push(path.relative(this.root, abs));
    }
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    if (out.length >= MAX_TREE_ENTRIES) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= MAX_TREE_ENTRIES) return;
      if (IGNORED_DIR_NAMES.has(entry.name) || SECRET_NAME.test(entry.name)) continue;

      const abs = path.join(dir, entry.name);
      const rel = path.relative(this.root, abs);

      if (entry.isDirectory()) {
        out.push(rel + "/");
        await this.walk(abs, out);
        continue;
      }
      if (entry.isFile()) out.push(rel);
    }
  }
}

/** `*.ts` → también matchea `src/a.ts` y `a.ts` en la raíz. Sin minimatch. */
export function globToRegExp(pattern: string): RegExp {
  const raw = pattern.trim() || "**/*";
  const body = raw
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\0")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, "(?:.*/)?")
    .replace(/\?/g, "[^/]");
  if (!raw.includes("/")) return new RegExp(`(?:^|/)${body}$`);
  return new RegExp(`^${body}$`);
}
