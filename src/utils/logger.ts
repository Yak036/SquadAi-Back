const prefix = "[squad]";

export type TraceActor = "boss" | "worker" | "qa" | "system" | "chat";

export type TraceEvent = {
  at: string;
  actor: TraceActor;
  event: string;
  detail: string;
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

  const push = (actor: TraceActor, event: string, detail = ""): void => {
    const row: TraceEvent = { at: new Date().toISOString(), actor, event, detail };
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

export function clip(text: string, max = 180): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max) + "…";
}
