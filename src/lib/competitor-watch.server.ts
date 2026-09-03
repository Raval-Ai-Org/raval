// Server-only competitor watch engine.
// Scans each enabled watch URL, extracts a small structural snapshot, diffs
// against the previous snapshot, and inserts alerts. Imported only from
// server handlers (cron route + auth'd "run now" server fn).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Snapshot = {
  fetchedAt: string;
  status: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  tagline: string | null; // best-guess above-the-fold positioning line
  promotions: string[]; // detected promo phrases
  ctas: string[]; // primary button/link labels
  internalLinks: string[]; // pathnames on same host
  contentHash: string; // rough body hash
};

const PROMO_PATTERNS = [
  /\b\d{1,2}\s?%\s*(off|discount)\b/i,
  /\bfree\s+(trial|tier|plan|shipping|month)\b/i,
  /\bblack\s*friday\b/i,
  /\bcyber\s*monday\b/i,
  /\blaunch(ing)?\b/i,
  /\bnew\s+(pricing|plan|feature|product)\b/i,
  /\blimited\s+time\b/i,
  /\bearly\s+access\b/i,
  /\bbeta\b/i,
  /\bwaitlist\b/i,
  /\bsave\s+\$\d+/i,
];

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function pickAll(html: string, re: RegExp, cap = 8): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = rx.exec(html)) && out.length < cap) {
    const v = m[1].replace(/\s+/g, " ").trim();
    if (v && v.length < 140) out.push(v);
  }
  return out;
}

function hash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

function normalizeUrl(input: string): string {
  const u = input.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

export async function snapshot(url: string): Promise<Snapshot> {
  const target = normalizeUrl(url);
  const { assertPublicUrl } = await import("@/server/api-auth");
  assertPublicUrl(target);
  const res = await fetch(target, {
    redirect: "follow",
    headers: {
      "User-Agent": `MelloxAI-CompetitorWatch/1.0 (+${process.env.APP_URL || "https://raval.ai"})`,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const status = res.status;
  const html = await res.text();

  const title = pick(html, /<title[^>]*>([^<]{1,300})<\/title>/i);
  const description =
    pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i) ??
    pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,400})["']/i);
  const h1 = pick(html, /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i);
  const h1Text = h1 ? stripTags(h1) : null;

  // Tagline: prefer og:title-different-from-title heroic subline
  const heroBlock = html.slice(0, 8000);
  const tagline =
    pick(heroBlock, /<h2[^>]*>([\s\S]{5,220}?)<\/h2>/i)
      ?.replace(/<[^>]+>/g, "")
      .trim() ??
    pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);

  const bodyText = stripTags(html.slice(0, 40_000));
  const promotions = Array.from(
    new Set(
      PROMO_PATTERNS.flatMap((rx) => {
        const m = bodyText.match(
          new RegExp(rx.source, rx.flags + (rx.flags.includes("g") ? "" : "g")),
        );
        return m ? m.map((s) => s.trim()) : [];
      }),
    ),
  ).slice(0, 8);

  const ctas = Array.from(
    new Set(
      [
        ...pickAll(
          html,
          /<a[^>]+class=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]{2,60}?)<\/a>/i,
          6,
        ),
        ...pickAll(html, /<button[^>]*>([\s\S]{2,60}?)<\/button>/i, 6),
      ].map((s) => stripTags(s)),
    ),
  )
    .filter(Boolean)
    .slice(0, 10);

  // Internal links (same host pathnames)
  const host = new URL(target).host;
  const linkPaths = new Set<string>();
  const linkRx = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRx.exec(html)) && linkPaths.size < 200) {
    try {
      const u = new URL(lm[1], target);
      if (u.host === host) {
        const p = u.pathname.replace(/\/+$/, "") || "/";
        if (p.length < 120 && !/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip)$/i.test(p))
          linkPaths.add(p);
      }
    } catch {
      /* ignore */
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    status,
    title: title ? stripTags(title) : null,
    description,
    h1: h1Text,
    tagline: tagline ? stripTags(tagline) : null,
    promotions,
    ctas,
    internalLinks: Array.from(linkPaths).sort(),
    contentHash: hash(bodyText),
  };
}

type AlertRow = {
  workspace_id: string;
  watch_id: string;
  kind: "new_page" | "promotion" | "positioning" | "title" | "cta";
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string | null;
  before_value?: string | null;
  after_value?: string | null;
  source_url?: string | null;
};

export function diffSnapshots(
  workspace_id: string,
  watch_id: string,
  source_url: string,
  prev: Snapshot | null,
  next: Snapshot,
): AlertRow[] {
  const out: AlertRow[] = [];
  if (!prev) return out; // first snapshot: baseline only

  if (prev.title && next.title && prev.title !== next.title) {
    out.push({
      workspace_id,
      watch_id,
      source_url,
      kind: "title",
      severity: "info",
      title: `Homepage title changed`,
      detail: `"${prev.title}" → "${next.title}"`,
      before_value: prev.title,
      after_value: next.title,
    });
  }
  const prevPos = prev.tagline ?? prev.description ?? prev.h1;
  const nextPos = next.tagline ?? next.description ?? next.h1;
  if (prevPos && nextPos && prevPos !== nextPos) {
    out.push({
      workspace_id,
      watch_id,
      source_url,
      kind: "positioning",
      severity: "warning",
      title: `Positioning line changed`,
      detail: `"${prevPos}" → "${nextPos}"`,
      before_value: prevPos,
      after_value: nextPos,
    });
  }

  const newPromos = next.promotions.filter((p) => !prev.promotions.includes(p));
  for (const p of newPromos.slice(0, 4)) {
    out.push({
      workspace_id,
      watch_id,
      source_url,
      kind: "promotion",
      severity: "warning",
      title: `New promotion detected`,
      detail: p,
      after_value: p,
    });
  }

  const prevLinks = new Set(prev.internalLinks);
  const newPages = next.internalLinks.filter((p) => !prevLinks.has(p));
  for (const path of newPages.slice(0, 5)) {
    let full = path;
    try {
      full = new URL(path, source_url).toString();
    } catch {
      /* keep */
    }
    out.push({
      workspace_id,
      watch_id,
      source_url: full,
      kind: "new_page",
      severity: "info",
      title: `New page: ${path}`,
      detail: `First seen on ${new Date(next.fetchedAt).toUTCString()}`,
      after_value: path,
    });
  }

  const prevCtas = new Set(prev.ctas.map((c) => c.toLowerCase()));
  const newCtas = next.ctas.filter((c) => !prevCtas.has(c.toLowerCase()));
  if (newCtas.length > 0) {
    out.push({
      workspace_id,
      watch_id,
      source_url,
      kind: "cta",
      severity: "info",
      title: `New call-to-action`,
      detail: newCtas.slice(0, 4).join(" · "),
      after_value: newCtas.join(" · "),
    });
  }

  return out;
}

export async function scanWatch(watchId: string): Promise<{ alerts: number; error?: string }> {
  const { data: watch, error } = await supabaseAdmin
    .from("competitor_watches")
    .select("id, workspace_id, url, enabled, last_snapshot")
    .eq("id", watchId)
    .single();
  if (error || !watch) return { alerts: 0, error: error?.message ?? "not found" };
  if (!watch.enabled) return { alerts: 0 };

  try {
    const next = await snapshot(watch.url);
    const prev = (watch.last_snapshot ?? null) as Snapshot | null;
    const alerts = diffSnapshots(watch.workspace_id, watch.id, normalizeUrl(watch.url), prev, next);

    if (alerts.length > 0) {
      await supabaseAdmin.from("competitor_alerts").insert(alerts);
    }
    await supabaseAdmin
      .from("competitor_watches")
      .update({
        last_snapshot: JSON.parse(JSON.stringify(next)),
        last_checked_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", watch.id);

    return { alerts: alerts.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabaseAdmin
      .from("competitor_watches")
      .update({ last_checked_at: new Date().toISOString(), last_error: msg })
      .eq("id", watch.id);
    return { alerts: 0, error: msg };
  }
}

export async function runDueCompetitorScans({
  max = 50,
  staleMinutes = 60 * 20,
}: { max?: number; staleMinutes?: number } = {}): Promise<{ scanned: number; alerts: number }> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: due } = await supabaseAdmin
    .from("competitor_watches")
    .select("id")
    .eq("enabled", true)
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .limit(max);

  let scanned = 0;
  let alerts = 0;
  for (const row of (due ?? []) as Array<{ id: string }>) {
    const r = await scanWatch(row.id);
    scanned += 1;
    alerts += r.alerts;
  }
  return { scanned, alerts };
}
