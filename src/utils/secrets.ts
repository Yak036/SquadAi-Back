/** Enmascara una API key para el frontend. Nunca devolver el valor crudo en GET. */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

/** El frontend reenvía el mask; no hay que persistirlo otra vez. */
export function looksMasked(value: string): boolean {
  return /[•*]/.test(value) || /^sk-.?•/.test(value);
}

export function isUsableKey(value: string): boolean {
  return Boolean(value) && !value.includes("tu_api_key") && !looksMasked(value);
}
