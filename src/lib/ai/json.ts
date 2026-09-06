// Shared JSON parsing helpers for AI responses.
// Model output is often wrapped in ```json fences or contains a leading
// prose paragraph; the helpers below tolerate both.

export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractFirstJsonObject(raw: string): string | null {
  const cleaned = stripJsonFences(raw);
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) return cleaned;
  const m = cleaned.match(/(\{|\[)[\s\S]*(\}|\])/);
  return m ? m[0] : null;
}

export function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(stripJsonFences(raw)) as T;
  } catch {
    const inner = extractFirstJsonObject(raw);
    if (!inner) return fallback;
    try {
      return JSON.parse(inner) as T;
    } catch {
      return fallback;
    }
  }
}
