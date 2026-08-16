import OpenAI from "openai";
import { env } from "./env.js";

/** Cliente único apuntando a DeepSeek (API compatible con OpenAI). */
export const deepseek = new OpenAI({
  apiKey: env.deepseekApiKey || "missing-key",
  baseURL: env.deepseekBaseUrl,
});
