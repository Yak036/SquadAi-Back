import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { deepseek } from "../config/openai.js";
import { parseLlmJson } from "../utils/json.js";
import { log } from "../utils/logger.js";

type ChatParams = {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
};

/**
 * Una llamada chat → JSON parseado.
 * Reasoner no usa temperature. Si json_object falla, reintenta en texto crudo
 * y deja que parseLlmJson limpie fences/markdown.
 */
export async function chatJson<T>(params: ChatParams): Promise<T> {
  const raw = await chatText(params);
  return parseLlmJson<T>(raw);
}

export async function chatText(params: ChatParams): Promise<string> {
  const isReasoner = params.model.includes("reasoner");
  const max_tokens = params.maxTokens ?? 8192;

  const base = {
    model: params.model,
    messages: params.messages,
    max_tokens,
  };

  let completion;
  try {
    completion = await deepseek.chat.completions.create({
      ...base,
      response_format: { type: "json_object" },
      ...(isReasoner ? {} : { temperature: 0.2 }),
    });
  } catch (err) {
    log.warn("json_object no soportado, reintento en texto:", err instanceof Error ? err.message : err);
    completion = await deepseek.chat.completions.create({
      ...base,
      ...(isReasoner ? {} : { temperature: 0.2 }),
    });
  }

  const content = completion.choices[0]?.message.content;
  if (!content?.trim()) {
    throw new Error(`LLM ${params.model} devolvió content vacío`);
  }
  return content;
}

export type { OpenAI, ChatCompletionMessageParam };
