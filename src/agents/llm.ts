import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { getDeepseek } from "../config/openai.js";
import { parseLlmJson } from "../utils/json.js";
import { log } from "../utils/logger.js";

type ChatParams = {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: ChatCompletionTool[];
};

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
  const client = getDeepseek();
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

  let turn = readTurn(completion);
  if (!turn.content.trim() && turn.toolCalls.length === 0 && !useTools) {
    if (params.signal?.aborted) {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    log.warn(`LLM ${params.model} content vacío, reintento sin json_object`);
    delete body.response_format;
    completion = await client.chat.completions.create(body as never, opts);
    turn = readTurn(completion);
  }

  return turn;
}

function readTurn(completion: {
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
}): LlmTurn {
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
  return {
    content: message?.content ?? "",
    reasoning: message?.reasoning_content?.trim() ?? "",
    toolCalls,
  };
}
