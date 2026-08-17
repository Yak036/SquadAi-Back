/**
 * Parsea JSON salido de un LLM: a menudo viene envuelto en markdown
 * (```json ... ```), con prosa alrededor, o con BOM.
 *
 * Importante: un README dentro de `code` trae fences ```bash. Si recortamos
 * el primer ``` del string, rompemos JSON válido. Por eso:
 *  1) JSON.parse del texto entero
 *  2) solo entonces, unwrap de un fence EXTERIOR ```json
 *  3) recorte por llaves balanceadas (ignorando { } dentro de strings)
 */
export function parseLlmJson<T>(raw: string): T {
  if (!raw.trim()) {
    throw new Error("Respuesta vacía del LLM");
  }

  const text = raw.trim().replace(/^\uFEFF/, "");

  const direct = tryParse(text);
  if (direct !== undefined) return direct as T;

  const unwrapped = unwrapOuterJsonFence(text);
  if (unwrapped) {
    const fromFence = tryParse(unwrapped) ?? tryParse(extractJsonSlice(unwrapped));
    if (fromFence !== undefined) return fromFence as T;
  }

  const sliced = tryParse(extractJsonSlice(text));
  if (sliced !== undefined) return sliced as T;

  throw new Error(`JSON inválido del LLM: ${text.slice(0, 240)}`);
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Quita un wrapper ```json ... ``` (o ``` sin lenguaje) SOLO si el texto
 * empieza por el fence. No busca ```bash/```ts a mitad del payload.
 */
export function unwrapOuterJsonFence(text: string): string | null {
  if (!text.startsWith("```")) return null;
  const nl = text.indexOf("\n");
  if (nl === -1) return null;
  const lang = text.slice(3, nl).trim().toLowerCase();
  if (lang && lang !== "json") return null;
  const close = text.lastIndexOf("```");
  if (close <= nl) return null;
  return text.slice(nl + 1, close).trim();
}

/**
 * Recorta al primer objeto/array JSON, respetando strings y escapes.
 * Así `{` dentro de `code` no se confunde con el cierre del envelope.
 */
export function extractJsonSlice(text: string): string {
  const start = indexOfJsonStart(text);
  if (start === -1) return text;
  const end = findMatchingClose(text, start);
  if (end === -1) return text.slice(start);
  return text.slice(start, end + 1);
}

function indexOfJsonStart(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") return i;
  }
  return -1;
}

function findMatchingClose(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === "\"") inString = false;
      continue;
    }
    if (c === "\"") {
      inString = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Si el modelo ignoró el envelope y vomitó el archivo (típico en .md),
 * devolvemos el cuerpo. No se usa si el texto parece JSON de worker.
 */
export function recoverRawFile(content: string): string | null {
  const trimmed = content.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return null;
  if (/^\s*\{/.test(trimmed) && /"filepath"\s*:/.test(trimmed)) return null;

  let body = trimmed;
  const outer = unwrapOuterJsonFence(body);
  if (outer) body = outer;
  else if (body.startsWith("```")) {
    const nl = body.indexOf("\n");
    const close = body.lastIndexOf("```");
    if (nl !== -1 && close > nl) body = body.slice(nl + 1, close).trim();
  }

  return body || null;
}
