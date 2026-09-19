export function safeNextPath(value: string | null | undefined, fallback = "/projects") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const parsed = new URL(value, "http://mellox.local");
    if (parsed.origin !== "http://mellox.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
