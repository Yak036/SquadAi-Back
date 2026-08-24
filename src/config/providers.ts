/**
 * Presets de proveedores OpenAI-compatibles.
 * Cualquier otro id vale si mandás baseUrl en /connect.
 */
export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { id: "deepinfra", label: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "together", label: "Together", baseUrl: "https://api.together.xyz/v1" },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { id: "fireworks", label: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "xai", label: "xAI", baseUrl: "https://api.x.ai/v1" },
  { id: "ollama", label: "Ollama local", baseUrl: "http://127.0.0.1:11434/v1" },
];

export function presetFor(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id.trim().toLowerCase());
}

export function needsAnthropicHeaders(id: string, baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return id === "anthropic" || u.includes("anthropic.com");
}

/** Ollama no exige key real; el SDK igual quiere un string. */
export function isLocalOllama(id: string, baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return id === "ollama" || u.includes(":11434");
}

/** Headers extra que algunos gateways piden (Anthropic version, OpenRouter attribution). */
export function extraLlmHeaders(id: string, baseUrl: string): Record<string, string> | undefined {
  const h: Record<string, string> = {};
  if (needsAnthropicHeaders(id, baseUrl)) h["anthropic-version"] = "2023-06-01";
  if (id === "openrouter" || baseUrl.toLowerCase().includes("openrouter.ai")) {
    h["HTTP-Referer"] = "http://localhost";
    h["X-Title"] = "SquadAi";
  }
  return Object.keys(h).length ? h : undefined;
}
