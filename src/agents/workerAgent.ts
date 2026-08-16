import { env } from "../config/env.js";
import type { WorkerFile } from "../types.js";
import { AppError } from "../utils/errors.js";
import { chatJson } from "./llm.js";

const WORKER_SYSTEM = `Eres el Trabajador: generas el contenido COMPLETO de un archivo.
Responde ÚNICAMENTE un JSON (sin markdown, sin backticks) con esta forma exacta:
{
  "filepath": "ruta/relativa.ts",
  "code": "// contenido completo del archivo"
}

Reglas:
- code es el archivo entero, no un diff
- Escapa bien saltos de línea y comillas dentro de code (JSON válido)
- No inventes dependencias que no estén en la spec
- Si hay feedback de QA, corrige exactamente eso y reescribe el archivo completo`;

function asWorkerFile(raw: unknown): WorkerFile {
  if (!raw || typeof raw !== "object") throw new AppError("Salida del trabajador inválida", 502);
  const o = raw as Record<string, unknown>;
  const filepath = String(o.filepath ?? "").trim();
  const code = typeof o.code === "string" ? o.code : "";
  if (!filepath || !code) {
    throw new AppError("El trabajador no devolvió filepath/code", 502);
  }
  return { filepath, code };
}

export async function generateFile(input: {
  requirement: string;
  filepath: string;
  specification: string;
  existingCode?: string;
  feedback?: string;
}): Promise<WorkerFile> {
  const parts = [
    `REQUERIMIENTO:\n${input.requirement}`,
    `FILEPATH OBJETIVO:\n${input.filepath}`,
    `ESPECIFICACIÓN:\n${input.specification}`,
  ];
  if (input.existingCode) {
    parts.push(`CÓDIGO ACTUAL DEL ARCHIVO:\n${input.existingCode}`);
  }
  if (input.feedback) {
    parts.push(`FEEDBACK DE QA (corrige esto):\n${input.feedback}`);
  }

  const raw = await chatJson<unknown>({
    model: env.workerModel,
    messages: [
      { role: "system", content: WORKER_SYSTEM },
      { role: "user", content: parts.join("\n\n") },
    ],
  });

  const file = asWorkerFile(raw);
  // El trabajador a veces cambia el path; nos quedamos con el pedido por el plan.
  return { filepath: input.filepath, code: file.code };
}
