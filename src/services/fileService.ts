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
    return { action, file: this.toRelative(abs), path: abs };
  }

  /** Árbol plano para darle contexto al Jefe (sin node_modules/.git/secretos). */
  async listTree(): Promise<string> {
    const names: string[] = [];
    await this.walk(this.root, names);
    if (names.length === 0) return "(workspace vacío)";
    const extra = names.length >= MAX_TREE_ENTRIES ? `\n… (${names.length}+ recortado)` : "";
    return names.join("\n") + extra;
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
