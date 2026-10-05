// What a strategy is allowed to keep, and what the rest of Mellox reads from it.
//
// Pure. The model proposes; this decides. A competitor the workspace doesn't
// track, or a market play with no source Market Brain really collected, is
// dropped — the same rule as competitor discovery and opportunities.
import type { Strategy as AutopilotStrategy } from "@/lib/autopilot/contracts";
import {
  STAGE_LABELS,
  STRATEGY_STAGES,
  STRATEGY_VERSION,
  StrategySchema,
  type MarketingStrategy,
  type StrategyFacts,
} from "./contracts";

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    : [];

const strings = (value: unknown, max: number, len: number): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => clean(v, len))
    .filter((v) => v.length >= 2)
    .slice(0, max);

/** A URL reduced to what identifies the page, for matching against sources. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/** Shares as whole numbers that add up to exactly 100. */
export function normalizeShares(shares: number[]): number[] {
  if (!shares.length) return [];
  const safe = shares.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  const base = total > 0 ? safe.map((s) => (s / total) * 100) : safe.map(() => 100 / safe.length);
  const floor = base.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  // Hand the remainder to the largest fractions, earliest first on a tie.
  const order = base
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor;
}

/**
 * Turn a model's answer into a strategy that only says things the workspace
 * can stand behind. Returns null when what is left isn't a usable strategy.
 */
export function groundStrategy(raw: unknown, facts: StrategyFacts): MarketingStrategy | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

  const byId = new Map(facts.competitors.map((c) => [c.id.toLowerCase(), c]));
  const byUrl = new Map(facts.sources.map((s) => [urlKey(s.url), s] as const).filter(([k]) => k));
  const groups = new Map(facts.audiences.map((n) => [n.trim().toLowerCase(), n.trim()]));

  const seenCompetitor = new Set<string>();
  const competitors = rows(o.competitors).flatMap((r) => {
    const hit = byId.get(clean(r.competitorId, 60).toLowerCase());
    const ourEdge = clean(r.ourEdge, 260);
    if (!hit || seenCompetitor.has(hit.id) || ourEdge.length < 2) return [];
    seenCompetitor.add(hit.id);
    return [
      { competitorId: hit.id, name: hit.name, theirAngle: clean(r.theirAngle, 220), ourEdge },
    ];
  });

  const seenPlay = new Set<string>();
  const plays = rows(o.plays).flatMap((r) => {
    const key = urlKey(clean(r.sourceUrl, 600));
    const hit = key ? byUrl.get(key) : undefined;
    const title = clean(r.title, 90);
    if (!hit || seenPlay.has(key) || title.length < 2) return [];
    seenPlay.add(key);
    return [
      {
        title,
        detail: clean(r.detail, 260),
        sourceUrl: hit.url,
        sourceTitle: clean(hit.title, 160),
      },
    ];
  });

  // With Audience set up, a strategy speaks to those groups and no invented one.
  const audiences = rows(o.audiences).flatMap((r) => {
    const name = clean(r.name, 80);
    const real = groups.size ? groups.get(name.toLowerCase()) : name;
    if (!real || real.length < 2) return [];
    return [{ name: real, why: clean(r.why, 200), message: clean(r.message, 220) }];
  });

  const pillarRows = rows(o.pillars)
    .map((r) => ({
      title: clean(r.title, 60),
      detail: clean(r.detail, 200),
      share: Number(r.share),
    }))
    .filter((p) => p.title.length >= 2)
    .slice(0, 5);
  const shares = normalizeShares(pillarRows.map((p) => p.share));
  const pillars = pillarRows.map((p, i) => ({ ...p, share: shares[i] }));

  const connected = new Set(facts.platforms.map((p) => p.toLowerCase()));
  const channels = rows(o.channels)
    .map((r) => ({
      platform: clean(r.platform, 30).toLowerCase(),
      role: clean(r.role, 160),
      perWeek: Math.max(0, Math.min(21, Math.round(Number(r.perWeek) || 0))),
      formats: strings(r.formats, 4, 30),
    }))
    .filter((c) => c.platform.length >= 2)
    // Connected accounts first: a plan should start where posts can really go out.
    .sort((a, b) => Number(connected.has(b.platform)) - Number(connected.has(a.platform)))
    .slice(0, 6);

  const pos = obj(o.positioning);
  const goal = obj(o.goal);
  const messages = obj(o.messages);
  const rules = obj(o.rules);

  const parsed = StrategySchema.safeParse({
    v: STRATEGY_VERSION,
    positioning: {
      statement: clean(pos.statement, 320),
      promise: clean(pos.promise, 200),
      differentiators: strings(pos.differentiators, 4, 140),
    },
    goal: {
      type: goal.type,
      summary: clean(goal.summary, 240),
      metric: clean(goal.metric, 80),
      target: clean(goal.target, 80),
    },
    audiences: audiences.slice(0, 4),
    voice: clean(o.voice, 160),
    pillars,
    channels,
    messages: Object.fromEntries(STRATEGY_STAGES.map((s) => [s, clean(messages[s], 240)])),
    competitors: competitors.slice(0, 5),
    plays: plays.slice(0, 5),
    roadmap: rows(o.roadmap)
      .map((r) => ({
        phase: clean(r.phase, 40),
        focus: clean(r.focus, 140),
        actions: strings(r.actions, 4, 160),
      }))
      .filter((r) => r.phase.length >= 2 && r.focus.length >= 2)
      .slice(0, 3),
    kpis: rows(o.kpis)
      .map((r) => ({
        label: clean(r.label, 60),
        target: clean(r.target, 60),
        why: clean(r.why, 160),
      }))
      .filter((k) => k.label.length >= 2)
      .slice(0, 5),
    rules: { do: strings(rules.do, 5, 160), dont: strings(rules.dont, 5, 160) },
  });
  return parsed.success ? parsed.data : null;
}

/** A person's edit: same shape, same grounding, never a new competitor or source. */
export function sanitizeEdit(raw: unknown, facts: StrategyFacts): MarketingStrategy | null {
  return groundStrategy(raw, facts);
}

/** The short strategy Autopilot plans against (its own, older shape). */
export function toAutopilotStrategy(s: MarketingStrategy): AutopilotStrategy {
  const audience = s.audiences
    .map((a) => (a.why ? `${a.name} (${a.why})` : a.name))
    .join("; ")
    .slice(0, 240);
  return {
    summary: `${s.positioning.statement} ${s.goal.summary}`.trim().slice(0, 400),
    audience,
    voice: s.voice.slice(0, 160),
    pillars: s.pillars.slice(0, 5).map((p) => ({ title: p.title, detail: p.detail })),
  };
}

/**
 * The strategy as every generator reads it: compact, stable order (so response
 * caches hit), capped. It steers what a piece is about and who it is for; it
 * never adds facts.
 */
export function strategyBlock(s: MarketingStrategy, maxChars = 2000): string {
  const lines: string[] = ["## Marketing strategy (follow it)"];
  lines.push(`- Positioning: ${s.positioning.statement}`);
  if (s.positioning.promise) lines.push(`- Promise: ${s.positioning.promise}`);
  if (s.positioning.differentiators.length)
    lines.push(`- What makes it different: ${s.positioning.differentiators.join("; ")}`);
  lines.push(
    `- Goal: ${s.goal.summary}${s.goal.metric ? ` (watch: ${s.goal.metric}${s.goal.target ? `, aim ${s.goal.target}` : ""})` : ""}`,
  );
  for (const a of s.audiences) {
    lines.push(`- For ${a.name}${a.message ? `: say "${a.message}"` : ""}`);
  }
  lines.push(
    `- Themes (share of posts): ${s.pillars.map((p) => `${p.title} ${p.share}%${p.detail ? ` — ${p.detail}` : ""}`).join(" | ")}`,
  );
  for (const stage of STRATEGY_STAGES) {
    if (s.messages[stage]) lines.push(`- ${STAGE_LABELS[stage]}: ${s.messages[stage]}`);
  }
  for (const c of s.competitors) lines.push(`- Against ${c.name}: ${c.ourEdge}`);
  if (s.rules.do.length) lines.push(`- Always: ${s.rules.do.join("; ")}`);
  if (s.rules.dont.length) lines.push(`- Never: ${s.rules.dont.join("; ")}`);
  const out = lines.join("\n");
  return out.length <= maxChars ? out : `${out.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Posts a week the strategy asks for, per platform (for showing against Autopilot). */
export function weeklyCadence(s: MarketingStrategy): number {
  return s.channels.reduce((sum, c) => sum + c.perWeek, 0);
}
