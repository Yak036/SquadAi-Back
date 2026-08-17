/**
 * Tools de workspace para el modo chat: glob / read / grep.
 * El modelo pide; FileService ejecuta dentro del sandbox.
 */
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { FileService } from "./fileService.js";

export const WORKSPACE_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Lista archivos del workspace que matchean un glob. Ej: *.ts, src/**/*.tsx. Máximo 100. No entra a node_modules/.git/dist.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob relativo al workspace" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description:
        "Lee un archivo. offset es la línea de inicio (1). Por defecto 2000 líneas / 50KB. Si recorta, volvé a llamar con offset mayor.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa al workspace" },
          offset: { type: "integer", description: "Línea de inicio, default 1" },
          limit: { type: "integer", description: "Cuántas líneas, default 2000" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Busca un regex en el workspace. include filtra por glob (ej. *.ts). Máximo 100 matches.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex JS (sin barras)" },
          include: { type: "string", description: "Glob opcional, ej. *.ts" },
        },
        required: ["pattern"],
      },
    },
  },
];

function asRecord(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* argumentos rotos */
  }
  return {};
}

export async function runWorkspaceTool(files: FileService, name: string, argsJson: string): Promise<string> {
  const args = asRecord(argsJson);
  if (name === "glob") {
    return files.glob(String(args.pattern ?? "**/*"));
  }
  if (name === "read") {
    const rel = String(args.path ?? "").trim();
    if (!rel) return "path obligatorio";
    const offset = typeof args.offset === "number" ? args.offset : 1;
    const limit = typeof args.limit === "number" ? args.limit : 2000;
    return files.readSlice(rel, offset, limit);
  }
  if (name === "grep") {
    const pattern = String(args.pattern ?? "").trim();
    if (!pattern) return "pattern obligatorio";
    const include = typeof args.include === "string" ? args.include : undefined;
    return files.grep(pattern, include);
  }
  return `tool desconocida: ${name}`;
}
