import OpenAI from "openai";
import { extraLlmHeaders } from "./providers.js";
import { resolveLlm } from "../services/configService.js";

let client: OpenAI | undefined;
let fingerprint = "";

/**
 * Cliente del proveedor activo (OpenAI-compatible: OpenAI, Anthropic, DeepInfra, …).
 * Se recrea solo si cambió id, key o baseURL en SQLite.
 */
export function getLlm(): OpenAI {
  const llm = resolveLlm();
  const apiKey = llm.apiKey || "missing-key";
  const baseURL = llm.baseUrl;
  const headers = extraLlmHeaders(llm.id, baseURL);
  const next = `${llm.id}|${apiKey}|${baseURL}|${JSON.stringify(headers ?? {})}`;
  if (!client || fingerprint !== next) {
    client = new OpenAI({
      apiKey,
      baseURL,
      ...(headers ? { defaultHeaders: headers } : {}),
    });
    fingerprint = next;
  }
  return client;
}

/** Alias: el código viejo hablaba de DeepSeek; ahora es el LLM activo. */
export const getDeepseek = getLlm;
