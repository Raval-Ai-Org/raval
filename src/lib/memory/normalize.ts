// Text handling for memories: one clean sentence in, a stable identity out.
import { MEMORY_MAX_CHARS } from "./contracts";

/** One line, no control characters, no list or heading markers, no action tags. */
export function cleanMemoryText(text: unknown): string {
  return (
    String(text ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]+/g, " ")
      .replace(/\[\s*\[|\]\s*\]/g, " ")
      .replace(/<[^>]{0,80}>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s#>*\-•]+/, "")
      .trim()
      .slice(0, MEMORY_MAX_CHARS)
      .trim()
  );
}

/**
 * The same memory said twice has the same fingerprint: lowercase, letters and
 * digits only. Matches the backfill in the workspace_memory migration.
 */
export function fingerprintOf(text: string): string {
  const lower = text.toLowerCase();
  const words = lower.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return (words || lower.trim()).slice(0, MEMORY_MAX_CHARS);
}

/** The handle a model uses to point at a memory. */
export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}

export function isExpired(expiresAt: string | null, now: Date): boolean {
  return !!expiresAt && Date.parse(expiresAt) <= now.getTime();
}

/** "3 hours left", "2 days left". Empty for a lasting memory. */
export function timeLeft(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "";
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!(ms > 0)) return "Ended";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "Less than an hour left";
  if (hours < 36) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  const days = Math.round(hours / 24);
  return `${days} days left`;
}
