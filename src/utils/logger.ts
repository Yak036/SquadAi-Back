const prefix = "[squad]";

export type TraceActor = "boss" | "worker" | "qa" | "system" | "chat";

/** Tokens de una llamada. estimated=true si el proveedor no mandó usage (chars/4). */
export type TokenUsage = {
  prompt: number;
  completion: number;
  total: number;
  estimated: boolean;
};

export type TraceEvent = {
  at: string;
  actor: TraceActor;
  event: string;
  detail: string;
  usage?: TokenUsage;
};

export const log = {
  info: (...args: unknown[]) => console.log(prefix, ...args),
  warn: (...args: unknown[]) => console.warn(prefix, ...args),
  error: (...args: unknown[]) => console.error(prefix, ...args),
};

export type JobLogListener = (event: TraceEvent) => void;

/** Log de un job: pinta en consola, acumula y opcionalmente emite al HUD (SSE). */
export function createJobLog(onEvent?: JobLogListener) {
  const events: TraceEvent[] = [];

  const push = (actor: TraceActor, event: string, detail = "", usage?: TokenUsage): void => {
    const row: TraceEvent = { at: new Date().toISOString(), actor, event, detail };
    if (usage) row.usage = usage;
    events.push(row);
    onEvent?.(row);
    const tag = actor === "system" ? prefix : `${prefix}:${actor}`;
    if (detail) console.log(tag, event, "—", detail);
    else console.log(tag, event);
  };

  const banner = (title: string, lines: string[]): void => {
    console.log(`${prefix} ── ${title} ${"─".repeat(Math.max(0, 40 - title.length))}`);
    for (const line of lines) console.log(prefix, line);
    console.log(`${prefix} ────────────────────────────────────────────`);
  };

  return { events, push, banner };
}

export function emptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0, total: 0, estimated: false };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    prompt: a.prompt + b.prompt,
    completion: a.completion + b.completion,
    total: a.total + b.total,
    estimated: a.estimated || b.estimated,
  };
}

export function formatUsage(u: TokenUsage): string {
  const tag = u.estimated ? "est" : "api";
  return `in ${fmtTok(u.prompt)} · out ${fmtTok(u.completion)} · Σ ${fmtTok(u.total)} (${tag})`;
}

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function clip(text: string, max = 180): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max) + "…";
}
