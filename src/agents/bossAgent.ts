import { env } from "../config/env.js";
import type { PlanResult, QaResult, WorkerFile } from "../types.js";
import { AppError } from "../utils/errors.js";
import { chatJson } from "./llm.js";

const PLAN_SYSTEM = `Eres el Jefe de Arquitectura de un orquestador local tipo Cursor.
Analizas un requerimiento y el árbol del workspace, y divides el trabajo en archivos.

Responde ÚNICAMENTE un JSON (sin markdown) con esta forma:
{
  "summary": "resumen corto del plan",
  "files": [
    {
      "filepath": "ruta/relativa.ts",
      "action": "create" | "modify",
      "specification": "especificación técnica completa para el trabajador: qué debe contener el archivo, APIs, imports, edge cases"
    }
  ]
}

Reglas:
- filepath siempre relativa al workspace, nunca absoluta ni con ..
- No incluyas node_modules, .env, ni binarios
- Ordena files por dependencia (tipos/utils antes que servicios, etc.)
- Sé concreto en specification: el trabajador no verá más contexto que eso y el archivo actual si existe`;

const QA_SYSTEM = `Eres QA/Arquitecto. Evalúas si el código generado cumple la especificación, el requerimiento y prácticas sanas.

Responde ÚNICAMENTE un JSON (sin markdown):
{
  "approved": true o false,
  "feedback": "si approved=false, indica exactamente qué cambiar; si true, string vacío",
  "filepath": "ruta/relativa.ts"
}

Rechaza si: no compila a simple vista, ignora la spec, hay path raro, o el código está incompleto (TODOs vacíos, placeholders).
Aprueba código simple y correcto; no pidas over-engineering.`;

function asPlan(raw: unknown): PlanResult {
  if (!raw || typeof raw !== "object") throw new AppError("Plan inválido", 502);
  const o = raw as Record<string, unknown>;
  const files = Array.isArray(o.files) ? o.files : [];
  const mapped = files.map((f) => {
    const row = f as Record<string, unknown>;
    const action: PlanResult["files"][number]["action"] =
      row.action === "modify" ? "modify" : "create";
    return {
      filepath: String(row.filepath ?? ""),
      action,
      specification: String(row.specification ?? ""),
    };
  });
  if (mapped.length === 0 || mapped.some((f) => !f.filepath || !f.specification)) {
    throw new AppError("El Jefe no devolvió archivos utilizables", 502);
  }
  return { summary: String(o.summary ?? ""), files: mapped };
}

function asQa(raw: unknown, fallbackPath: string): QaResult {
  if (!raw || typeof raw !== "object") throw new AppError("QA inválido", 502);
  const o = raw as Record<string, unknown>;
  return {
    approved: Boolean(o.approved),
    feedback: String(o.feedback ?? ""),
    filepath: String(o.filepath ?? fallbackPath),
  };
}

export async function planWork(input: {
  requirement: string;
  tree: string;
}): Promise<PlanResult> {
  const raw = await chatJson<unknown>({
    model: env.bossModel,
    messages: [
      { role: "system", content: PLAN_SYSTEM },
      {
        role: "user",
        content: `REQUERIMIENTO:\n${input.requirement}\n\nÁRBOL DEL WORKSPACE:\n${input.tree}`,
      },
    ],
  });
  return asPlan(raw);
}

export async function reviewCode(input: {
  requirement: string;
  specification: string;
  generated: WorkerFile;
}): Promise<QaResult> {
  const raw = await chatJson<unknown>({
    model: env.bossModel,
    messages: [
      { role: "system", content: QA_SYSTEM },
      {
        role: "user",
        content: [
          `REQUERIMIENTO:\n${input.requirement}`,
          `SPEC:\n${input.specification}`,
          `FILEPATH:\n${input.generated.filepath}`,
          `CÓDIGO:\n${input.generated.code}`,
        ].join("\n\n"),
      },
    ],
  });
  return asQa(raw, input.generated.filepath);
}
