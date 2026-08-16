/**
 * Parsea JSON salido de un LLM: a menudo viene envuelto en markdown
 * (```json ... ```), con prosa alrededor, o con BOM.
 */
export function parseLlmJson<T>(raw: string): T {
  if (!raw.trim()) {
    throw new Error("Respuesta vacía del LLM");
  }

  let text = raw.trim().replace(/^\uFEFF/, "");

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    text = fence[1].trim();
  }

  const parsed = tryParse(text) ?? tryParse(extractJsonSlice(text));
  if (parsed === undefined) {
    throw new Error(`JSON inválido del LLM: ${text.slice(0, 240)}`);
  }

  return parsed as T;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Recorta al primer objeto/array JSON si el modelo añadió texto extra. */
export function extractJsonSlice(text: string): string {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");

  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);

  if (start === -1) return text;

  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return text;
  return text.slice(start, end + 1);
}
