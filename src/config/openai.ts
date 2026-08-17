import OpenAI from "openai";
import { resolveDeepseekBaseUrl, resolveDeepseekKey } from "../services/configService.js";

let client: OpenAI | undefined;
let fingerprint = "";

/** Cliente DeepSeek; se recrea solo si cambió la key o el baseURL en SQLite. */
export function getDeepseek(): OpenAI {
  const apiKey = resolveDeepseekKey() || "missing-key";
  const baseURL = resolveDeepseekBaseUrl();
  const next = `${apiKey}|${baseURL}`;
  if (!client || fingerprint !== next) {
    client = new OpenAI({ apiKey, baseURL });
    fingerprint = next;
  }
  return client;
}
