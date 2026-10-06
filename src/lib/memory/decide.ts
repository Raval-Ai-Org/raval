// decide.ts — the model proposes, this decides. Every memory change from chat
// or the background reader passes through here: nothing is saved twice, a
// removed memory isn't quietly brought back, secrets are refused, and a brand
// never holds more than MEMORY_LIMIT. Pure; the server only runs the result.
import {
  MAX_OPS_PER_TURN,
  MEMORY_KINDS,
  MEMORY_LIMIT,
  MEMORY_MIN_CHARS,
  MEMORY_TOPICS,
  TEMP_DEFAULT_HOURS,
  TEMP_MAX_HOURS,
  TEMP_MIN_HOURS,
  type MemoryChange,
  type MemoryKind,
  type MemoryOp,
  type MemorySource,
  type MemoryTopic,
  type StoredMemory,
} from "./contracts";
import { cleanMemoryText, fingerprintOf, isExpired } from "./normalize";

export type MemoryWrite =
  | {
      type: "insert";
      body: string;
      kind: MemoryKind;
      topic: MemoryTopic;
      fingerprint: string;
      expiresAt: string | null;
    }
  | {
      /** Also brings back a removed or expired row with the same meaning. */
      type: "update";
      id: string;
      body: string;
      kind?: MemoryKind;
      topic?: MemoryTopic;
      fingerprint: string;
      expiresAt?: string | null;
    }
  | { type: "remove"; id: string };

export type MemoryRefusal = {
  text: string;
  reason: "empty" | "sensitive" | "duplicate" | "removed-before" | "full" | "unknown-id";
};

export type MemoryDecision = {
  writes: MemoryWrite[];
  /** In the order they will happen. `id` is "" for a row not inserted yet. */
  changes: MemoryChange[];
  refused: MemoryRefusal[];
};

// Credentials, card and identity numbers, and a person's own health details
// don't belong in a list every teammate and every prompt can read.
const SENSITIVE: RegExp[] = [
  /\b(pass(word|code|phrase)|api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|private[\s_-]?key|pin)\b\s*(is|=|:)/i,
  /\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/,
  /\b[A-Za-z0-9+/_-]{40,}\b/,
  /\b(?:\d[ -]?){13,19}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(i am|i'm|i have|i was|i've been|my)\b[^.]{0,60}\b(diagnos\w*|medication|therapy|pregnan\w*|hiv|cancer|depress\w*)/i,
];

export function isSensitive(text: string): boolean {
  return SENSITIVE.some((re) => re.test(text));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** When a temporary memory ends. */
export function expiryFor(hours: number | undefined, now: Date): string {
  const n = Number.isFinite(hours) ? Number(hours) : TEMP_DEFAULT_HOURS;
  const clamped = Math.min(TEMP_MAX_HOURS, Math.max(TEMP_MIN_HOURS, n));
  return new Date(now.getTime() + clamped * 3_600_000).toISOString();
}

export type DecideOptions = {
  now: Date;
  /**
   * `chat` and `manual` are a person saying it now, so a memory removed earlier
   * may come back. `import` is the background reader: it never brings one back.
   */
  source: MemorySource;
  /** Extra refusal, e.g. the server's prompt-injection check. */
  refuse?: (text: string) => boolean;
};

export function applyMemoryOps(
  existing: readonly StoredMemory[],
  proposed: readonly MemoryOp[],
  opts: DecideOptions,
): MemoryDecision {
  const { now, source } = opts;
  const out: MemoryDecision = { writes: [], changes: [], refused: [] };
  const live = (m: StoredMemory) => m.status === "active" && !isExpired(m.expiresAt, now);
  // Working copies, so two proposals in one turn see each other.
  const rows = existing.map((m) => ({ ...m }));
  const byFingerprint = new Map(rows.map((m) => [m.fingerprint, m]));
  let activeCount = rows.filter(live).length;
  const find = (id: string) => {
    const wanted = String(id ?? "")
      .replace(/[^a-f0-9]/gi, "")
      .toLowerCase();
    if (wanted.length < 8) return undefined;
    const hits = rows.filter((m) => live(m) && m.id.replace(/-/g, "").startsWith(wanted));
    return hits.length === 1 ? hits[0] : undefined;
  };

  for (const op of proposed.slice(0, MAX_OPS_PER_TURN)) {
    if (op.op === "remove") {
      const row = find(op.id);
      if (!row) {
        out.refused.push({ text: String(op.id ?? ""), reason: "unknown-id" });
        continue;
      }
      row.status = "removed";
      activeCount--;
      out.writes.push({ type: "remove", id: row.id });
      out.changes.push({ op: "removed", id: row.id, text: row.body });
      continue;
    }

    const body = cleanMemoryText(op.text);
    if (body.length < MEMORY_MIN_CHARS) {
      out.refused.push({ text: body, reason: "empty" });
      continue;
    }
    if (isSensitive(body) || opts.refuse?.(body)) {
      out.refused.push({ text: body, reason: "sensitive" });
      continue;
    }
    const fingerprint = fingerprintOf(body);
    const same = byFingerprint.get(fingerprint);

    if (op.op === "update") {
      const row = find(op.id);
      if (!row) {
        out.refused.push({ text: body, reason: "unknown-id" });
        continue;
      }
      if (same && same.id !== row.id) {
        out.refused.push({ text: body, reason: "duplicate" });
        continue;
      }
      byFingerprint.delete(row.fingerprint);
      row.body = body;
      row.fingerprint = fingerprint;
      byFingerprint.set(fingerprint, row);
      out.writes.push({ type: "update", id: row.id, body, fingerprint });
      out.changes.push({
        op: "updated",
        id: row.id,
        text: body,
        temporary: !!row.expiresAt,
      });
      continue;
    }

    // add
    const kind = pick(op.kind, MEMORY_KINDS, "fact");
    const topic = pick(op.topic, MEMORY_TOPICS, "other");
    // What the team is working on right now always fades by itself.
    const temporary = kind === "context" || op.lasts === "hours";
    const expiresAt = temporary ? expiryFor(op.hours, now) : null;

    if (same && live(same)) {
      // Already known. Saying a temporary thing "for good" keeps it.
      if (same.expiresAt && !temporary) {
        same.expiresAt = null;
        out.writes.push({
          type: "update",
          id: same.id,
          body: same.body,
          fingerprint,
          expiresAt: null,
        });
        out.changes.push({ op: "updated", id: same.id, text: same.body });
      } else {
        out.refused.push({ text: body, reason: "duplicate" });
      }
      continue;
    }
    if (same && same.status === "removed" && source === "import") {
      out.refused.push({ text: body, reason: "removed-before" });
      continue;
    }
    if (activeCount >= MEMORY_LIMIT) {
      out.refused.push({ text: body, reason: "full" });
      continue;
    }
    activeCount++;
    if (same) {
      // A removed or ended row with the same meaning: bring it back.
      Object.assign(same, { status: "active", body, kind, topic, expiresAt });
      out.writes.push({ type: "update", id: same.id, body, kind, topic, fingerprint, expiresAt });
      out.changes.push({ op: "added", id: same.id, text: body, temporary });
      continue;
    }
    const placeholder: StoredMemory = {
      id: "",
      body,
      kind,
      topic,
      source,
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: "active",
      fingerprint,
    };
    rows.push(placeholder);
    byFingerprint.set(fingerprint, placeholder);
    out.writes.push({ type: "insert", body, kind, topic, fingerprint, expiresAt });
    out.changes.push({ op: "added", id: "", text: body, temporary });
  }
  return out;
}
