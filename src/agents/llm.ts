import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { getLlm } from "../config/openai.js";
import { parseLlmJson } from "../utils/json.js";
import { log, type TokenUsage } from "../utils/logger.js";
import { addUsage, emptyUsage, formatUsage } from "../utils/logger.js";

export { addUsage, emptyUsage, formatUsage, type TokenUsage };

type ChatParams = {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ChatCompletionTool[];
  /** Cada completion (API o estimado chars/4) pega acá. */
  onUsage?: (usage: TokenUsage) => void;
};

export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
  }
  return Math.ceil(chars / 4);
}

export type LlmJson<T> = {
  data: T;
  /** Cadena de pensamiento si el modelo la expone (reasoner / thinking). */
  reasoning: string;
};

export type LlmToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LlmTurn = {
  content: string;
  reasoning: string;
  toolCalls: LlmToolCall[];
  usage: TokenUsage;
};

/**
 * Una llamada chat → JSON parseado.
 * Reasoner no usa temperature. Si json_object falla, reintenta en texto crudo.
 */
export async function chatJson<T>(params: ChatParams): Promise<LlmJson<T>> {
  const { content, reasoning } = await chatText(params);
  return { data: parseLlmJson<T>(content), reasoning };
}

export async function chatText(params: ChatParams): Promise<{ content: string; reasoning: string }> {
  const turn = await chatTurn(params);
  if (!turn.content.trim()) {
    throw new Error(`LLM ${params.model} devolvió content vacío`);
  }
  return { content: turn.content, reasoning: turn.reasoning };
}

/**
 * Una llamada. Si hay tools, no usa json_object (chocan).
 * Content vacío está bien si vinieron tool_calls.
 */
export async function chatTurn(params: ChatParams): Promise<LlmTurn> {
  const isReasoner = params.model.includes("reasoner");
  const max_tokens = params.maxTokens ?? 8192;
  const client = getLlm();
  const useTools = Boolean(params.tools?.length);

  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens,
  };
  if (!isReasoner) body.temperature = 0.2;
  if (useTools) {
    body.tools = params.tools;
    body.tool_choice = "auto";
  } else {
    body.response_format = { type: "json_object" };
  }

  const opts = params.signal ? { signal: params.signal } : undefined;

  let completion;
  try {
    completion = await client.chat.completions.create(body as never, opts);
  } catch (err) {
    if (params.signal?.aborted) throw err;
    if (useTools) {
      log.warn("tools no soportadas, reintento sin tools:", err instanceof Error ? err.message : err);
      const rest = { ...params };
      delete rest.tools;
      return chatTurn(rest);
    }
    if (!useTools && body.response_format) {
      log.warn("json_object no soportado, reintento en texto:", err instanceof Error ? err.message : err);
      delete body.response_format;
      completion = await client.chat.completions.create(body as never, opts);
    } else {
      throw err;
    }
  }

  let turn = readTurn(completion, params.messages);
  if (!turn.content.trim() && turn.toolCalls.length === 0 && !useTools) {
    if (params.signal?.aborted) {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    log.warn(`LLM ${params.model} content vacío, reintento sin json_object`);
    delete body.response_format;
    completion = await client.chat.completions.create(body as never, opts);
    turn = readTurn(completion, params.messages);
  }

  params.onUsage?.(turn.usage);
  return turn;
}

function readTurn(
  completion: {
    choices: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  },
  messages: ChatCompletionMessageParam[],
): LlmTurn {
  const message = completion.choices[0]?.message;
  const toolCalls: LlmToolCall[] = [];
  for (const tc of message?.tool_calls ?? []) {
    if (tc.type && tc.type !== "function") continue;
    const name = tc.function?.name?.trim();
    if (!name || !tc.id) continue;
    toolCalls.push({
      id: tc.id,
      name,
      arguments: tc.function?.arguments ?? "{}",
    });
  }
  const content = message?.content ?? "";
  return {
    content,
    reasoning: message?.reasoning_content?.trim() ?? "",
    toolCalls,
    usage: usageFrom(completion.usage, messages, content),
  };
}

/** usage de la API si vino; si no, chars/4 (techo: tiktoken por modelo). */
function usageFrom(
  raw: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | undefined,
  messages: ChatCompletionMessageParam[],
  content: string,
): TokenUsage {
  const prompt = raw?.prompt_tokens ?? raw?.input_tokens ?? 0;
  const completion = raw?.completion_tokens ?? raw?.output_tokens ?? 0;
  const total = raw?.total_tokens ?? prompt + completion;
  if (prompt || completion || total) {
    return { prompt, completion, total, estimated: false };
  }
  const estPrompt = estimateTokens(messages);
  const estOut = Math.ceil(content.length / 4);
  return { prompt: estPrompt, completion: estOut, total: estPrompt + estOut, estimated: true };
}
