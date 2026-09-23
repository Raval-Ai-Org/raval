// Command Center model — the pure half of the agency view.
//
// Everything the Command Center shows is derived here from real rows: the
// workspace overview (one summary per client) and the recent content_items /
// approvals across those workspaces. No invented numbers: a figure the data
// cannot support is left out, never estimated.
//
// Browser-safe and side-effect free, so it is unit-tested directly.

export type ClientStatus = "active" | "onboarding" | "paused";
export type Role = "owner" | "admin" | "editor" | "viewer";

/** The subset of WorkspaceSummary the Command Center reads. */
export type CcClient = {
  id: string;
  name: string;
  websiteUrl: string | null;
  domain: string | null;
  logoUrl: string | null;
  industry: string | null;
  clientStatus: ClientStatus;
  role: Role;
  onboarded: boolean;
  pendingApprovals: number;
  draftCount: number;
  scheduledCount: number;
  publishedCount: number;
  failedCount: number;
  connectedSocialAccounts: number;
  geoScore: number | null;
  geoScannedAt: string | null;
  lastActivityAt: string;
};

export type CcContentRow = {
  id: string;
  workspace_id: string;
  agent: string;
  kind: string;
  channel: string | null;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  created_at: string;
};

export type CcApprovalRow = {
  id: string;
  workspace_id: string;
  action: string;
  status: string;
  created_at: string;
  payload: Record<string, unknown> | null;
};

const DAY = 86_400_000;
const EDIT_ROLES = new Set<Role>(["owner", "admin", "editor"]);

export function canEdit(role: Role | undefined | null): boolean {
  return Boolean(role && EDIT_ROLES.has(role));
}

/* ------------------------------------------------------------------ */
/* Review queue                                                        */
/* ------------------------------------------------------------------ */

export type ReviewItem = {
  id: string;
  /** content_items rows are decided through the content lifecycle; legacy approvals rows directly. */
  source: "content" | "approval";
  workspaceId: string;
  clientName: string;
  title: string;
  body: string | null;
  hashtags: string[];
  mediaUrl: string | null;
  channel: string | null;
  kind: string;
  status: string;
  createdAt: string;
  scheduledAt: string | null;
  canDecide: boolean;
};

function titleOf(row: Pick<CcContentRow, "title" | "body">, fallback: string): string {
  const t = row.title?.trim();
  if (t) return t;
  const b = row.body?.replace(/\s+/g, " ").trim();
  if (b) return b.length > 80 ? `${b.slice(0, 79)}…` : b;
  return fallback;
}

function toItem(row: CcContentRow, clients: Map<string, CcClient>, fallback: string): ReviewItem {
  const client = clients.get(row.workspace_id);
  return {
    id: row.id,
    source: "content",
    workspaceId: row.workspace_id,
    clientName: client?.name ?? "Client",
    title: titleOf(row, fallback),
    body: row.body,
    hashtags: row.hashtags ?? [],
    mediaUrl: row.media_url,
    channel: row.channel,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    canDecide: canEdit(client?.role),
  };
}

/** Everything waiting for a decision, newest first. Rows of unknown workspaces are dropped. */
export function buildReviewQueue(
  rows: CcContentRow[],
  approvals: CcApprovalRow[],
  clients: Map<string, CcClient>,
): ReviewItem[] {
  const content = rows
    .filter((r) => (r.status === "pending" || r.status === "draft") && clients.has(r.workspace_id))
    .map((r) => toItem(r, clients, "Untitled draft"));
  const legacy = approvals
    .filter((a) => a.status === "pending" && clients.has(a.workspace_id))
    .map<ReviewItem>((a) => {
      const p = a.payload ?? {};
      const client = clients.get(a.workspace_id);
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
      return {
        id: a.id,
        source: "approval",
        workspaceId: a.workspace_id,
        clientName: client?.name ?? "Client",
        title: str(a.action) ?? "Approval request",
        body: str(p.body) ?? str(p.caption) ?? str(p.summary),
        hashtags: [],
        mediaUrl: str(p.media_url),
        channel: str(p.channel),
        kind: "approval",
        status: a.status,
        createdAt: a.created_at,
        scheduledAt: null,
        canDecide: canEdit(client?.role),
      };
    });
  return [...content, ...legacy].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Approved work that is not scheduled or posted yet. */
export function buildReadyQueue(
  rows: CcContentRow[],
  clients: Map<string, CcClient>,
): ReviewItem[] {
  return rows
    .filter((r) => r.status === "approved" && clients.has(r.workspace_id))
    .map((r) => toItem(r, clients, "Approved post"));
}

/** Posts that failed to go out and need a retry or a fix. */
export function buildFailedQueue(
  rows: CcContentRow[],
  clients: Map<string, CcClient>,
): ReviewItem[] {
  return rows
    .filter(
      (r) =>
        (r.status === "failed" || r.status === "partial_failed") && clients.has(r.workspace_id),
    )
    .map((r) => toItem(r, clients, "Failed post"));
}

/**
 * The status a content row must pass through to reach `target`. The lifecycle
 * refuses draft → rejected, so a draft is discarded via pending.
 */
export function transitionPath(from: string, target: "approved" | "rejected"): string[] {
  if (target === "rejected" && from === "draft") return ["pending", "rejected"];
  return [target];
}

/**
 * Where undo sends a decided row. approved → pending is not a legal
 * transition, so an undone approval returns to draft (still in review).
 */
export function undoTarget(original: string, decided: "approved" | "rejected"): string {
  if (decided === "approved") return "draft";
  return original === "pending" ? "pending" : "draft";
}

/* ------------------------------------------------------------------ */
/* Client health                                                       */
/* ------------------------------------------------------------------ */

export type HealthTone = "good" | "warn" | "risk" | "idle";

export type ClientHealth = {
  tone: HealthTone;
  label: string;
  /** 0–100, from what the data says — used for the ring and for sorting. */
  score: number;
  reasons: string[];
};

export function clientHealth(c: CcClient): ClientHealth {
  if (c.clientStatus === "paused") {
    return { tone: "idle", label: "Paused", score: 0, reasons: ["Paused"] };
  }
  if (!c.onboarded || !c.domain) {
    return { tone: "warn", label: "Setup", score: 20, reasons: ["Setup not finished"] };
  }
  const reasons: string[] = [];
  let score = 100;
  if (c.failedCount > 0) {
    score -= 30;
    reasons.push(`${c.failedCount} failed`);
  }
  const waiting = c.pendingApprovals + c.draftCount;
  if (waiting >= 10) {
    score -= 20;
    reasons.push(`${waiting} waiting`);
  } else if (waiting >= 4) {
    score -= 10;
    reasons.push(`${waiting} waiting`);
  }
  if (c.scheduledCount === 0) {
    score -= 20;
    reasons.push("Nothing scheduled");
  }
  if (c.connectedSocialAccounts === 0) {
    score -= 15;
    reasons.push("No accounts");
  }
  if (c.geoScore !== null && c.geoScore < 50) {
    score -= 10;
    reasons.push("Low AI visibility");
  }
  score = Math.max(0, Math.min(100, score));
  const tone: HealthTone = score >= 80 ? "good" : score >= 55 ? "warn" : "risk";
  const label = tone === "good" ? "On track" : tone === "warn" ? "Check in" : "At risk";
  return { tone, label, score, reasons };
}

/* ------------------------------------------------------------------ */
/* Attention feed — "what needs you"                                   */
/* ------------------------------------------------------------------ */

export type AttentionAction =
  "review" | "ready" | "failed" | "setup" | "accounts" | "calendar" | "visibility";

export type AttentionItem = {
  key: string;
  priority: number; // higher first
  tone: "risk" | "warn" | "info";
  action: AttentionAction;
  workspaceId: string | null;
  title: string;
  detail: string;
  cta: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Ranked list of things to do across every client. Cross-client items first
 * (they clear the most in one go), then per-client problems by severity.
 */
export function buildAttention(
  clients: CcClient[],
  queues: { review: ReviewItem[]; ready: ReviewItem[]; failed: ReviewItem[] },
): AttentionItem[] {
  const out: AttentionItem[] = [];
  const reviewClients = new Set(queues.review.map((r) => r.workspaceId)).size;

  if (queues.failed.length > 0) {
    const n = new Set(queues.failed.map((r) => r.workspaceId)).size;
    out.push({
      key: "failed",
      priority: 100,
      tone: "risk",
      action: "failed",
      workspaceId: null,
      title: `${plural(queues.failed.length, "post")} didn't go out`,
      detail: `Across ${plural(n, "client")}. Retry or fix them.`,
      cta: "Fix",
    });
  }
  if (queues.review.length > 0) {
    out.push({
      key: "review",
      priority: 90,
      tone: "warn",
      action: "review",
      workspaceId: null,
      title: `${plural(queues.review.length, "draft")} to review`,
      detail: `From ${plural(reviewClients, "client")}.`,
      cta: "Review",
    });
  }
  if (queues.ready.length > 0) {
    out.push({
      key: "ready",
      priority: 70,
      tone: "info",
      action: "ready",
      workspaceId: null,
      title: `${plural(queues.ready.length, "post")} ready to go`,
      detail: "Approved, not scheduled yet.",
      cta: "Schedule",
    });
  }

  for (const c of clients) {
    if (c.clientStatus === "paused") continue;
    if (!c.onboarded || !c.domain) {
      out.push({
        key: `setup:${c.id}`,
        priority: 60,
        tone: "warn",
        action: "setup",
        workspaceId: c.id,
        title: `Finish setting up ${c.name}`,
        detail: "Add the website and brand details.",
        cta: "Set up",
      });
      continue;
    }
    if (c.connectedSocialAccounts === 0) {
      out.push({
        key: `accounts:${c.id}`,
        priority: 50,
        tone: "warn",
        action: "accounts",
        workspaceId: c.id,
        title: `${c.name} has no accounts connected`,
        detail: "Connect one to post from Mellox.",
        cta: "Connect",
      });
    }
    if (c.scheduledCount === 0 && c.clientStatus === "active") {
      out.push({
        key: `calendar:${c.id}`,
        priority: 40,
        tone: "info",
        action: "calendar",
        workspaceId: c.id,
        title: `Nothing scheduled for ${c.name}`,
        detail: "Plan the next posts.",
        cta: "Plan",
      });
    }
    if (c.geoScannedAt === null) {
      out.push({
        key: `visibility:${c.id}`,
        priority: 20,
        tone: "info",
        action: "visibility",
        workspaceId: c.id,
        title: `Check how AI sees ${c.name}`,
        detail: "No AI visibility scan yet.",
        cta: "Scan",
      });
    } else if (c.geoScore !== null && c.geoScore < 50) {
      out.push({
        key: `visibility:${c.id}`,
        priority: 35,
        tone: "warn",
        action: "visibility",
        workspaceId: c.id,
        title: `${c.name} scores ${c.geoScore} on AI visibility`,
        detail: "See what to fix.",
        cta: "Open",
      });
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export type ScheduleDay = { key: string; date: Date; items: ReviewItem[] };

/** Scheduled posts in [now − 1h, now + days], grouped by local day. */
export function groupSchedule(
  rows: CcContentRow[],
  clients: Map<string, CcClient>,
  now: number,
  days = 14,
): ScheduleDay[] {
  const from = now - 60 * 60 * 1000;
  const to = now + days * DAY;
  const items = rows
    .filter((r) => r.status === "scheduled" && r.scheduled_at && clients.has(r.workspace_id))
    .map((r) => ({ row: r, ts: new Date(r.scheduled_at as string).getTime() }))
    .filter(({ ts }) => Number.isFinite(ts) && ts >= from && ts <= to)
    .sort((a, b) => a.ts - b.ts);
  const byDay = new Map<string, ScheduleDay>();
  for (const { row, ts } of items) {
    const d = new Date(ts);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let day = byDay.get(key);
    if (!day) {
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      day = { key, date, items: [] };
      byDay.set(key, day);
    }
    day.items.push(toItem(row, clients, "Scheduled post"));
  }
  return [...byDay.values()];
}

export function dayLabel(date: Date, now: number): string {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/* Activity (real counts only)                                         */
/* ------------------------------------------------------------------ */

export type ActivityStats = {
  published14: number;
  publishedPrev14: number;
  scheduledNext14: number;
  clientsPosting: number;
  trend: { day: string; posts: number }[];
  byChannel: { channel: string; posts: number }[];
  byClient: { id: string; name: string; posts: number }[];
};

function localDayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function activityStats(
  rows: CcContentRow[],
  clients: Map<string, CcClient>,
  now: number,
): ActivityStats {
  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
  const published = rows.filter(
    (r) =>
      r.status === "published" &&
      clients.has(r.workspace_id) &&
      at(r.created_at) >= now - 14 * DAY &&
      at(r.created_at) <= now,
  );
  const publishedPrev14 = rows.filter(
    (r) =>
      r.status === "published" &&
      clients.has(r.workspace_id) &&
      at(r.created_at) >= now - 28 * DAY &&
      at(r.created_at) < now - 14 * DAY,
  ).length;
  const scheduledNext14 = rows.filter(
    (r) =>
      r.status === "scheduled" &&
      clients.has(r.workspace_id) &&
      at(r.scheduled_at) >= now &&
      at(r.scheduled_at) <= now + 14 * DAY,
  ).length;

  const todayStart = localDayStart(now);
  const trend = Array.from({ length: 14 }, (_, i) => {
    const start = todayStart - (13 - i) * DAY;
    return {
      day: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      posts: published.filter((r) => {
        const t = at(r.created_at);
        return t >= start && t < start + DAY;
      }).length,
    };
  });

  const count = <K extends string>(keyOf: (r: CcContentRow) => K) =>
    [
      ...published.reduce(
        (m, r) => m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1),
        new Map<K, number>(),
      ),
    ].sort((a, b) => b[1] - a[1]);

  return {
    published14: published.length,
    publishedPrev14,
    scheduledNext14,
    clientsPosting: new Set(published.map((r) => r.workspace_id)).size,
    trend,
    byChannel: count((r) => r.channel ?? "other").map(([channel, posts]) => ({ channel, posts })),
    byClient: count((r) => r.workspace_id).map(([id, posts]) => ({
      id,
      name: clients.get(id)?.name ?? "Client",
      posts,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Report (digest)                                                     */
/* ------------------------------------------------------------------ */

export type Digest = {
  dateLabel: string;
  clients: number;
  active: number;
  review: number;
  ready: number;
  scheduled: number;
  failed: number;
  published14: number;
  perClient: {
    name: string;
    review: number;
    scheduled: number;
    published: number;
    health: string;
  }[];
  waiting: { client: string; title: string }[];
};

export function buildDigest(input: {
  clients: CcClient[];
  review: ReviewItem[];
  ready: ReviewItem[];
  failed: ReviewItem[];
  scheduled: number;
  published14: number;
  now: number;
}): Digest {
  return {
    dateLabel: new Date(input.now).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    clients: input.clients.length,
    active: input.clients.filter((c) => c.clientStatus === "active").length,
    review: input.review.length,
    ready: input.ready.length,
    scheduled: input.scheduled,
    failed: input.failed.length,
    published14: input.published14,
    perClient: input.clients.map((c) => ({
      name: c.name,
      review: c.pendingApprovals + c.draftCount,
      scheduled: c.scheduledCount,
      published: c.publishedCount,
      health: clientHealth(c).label,
    })),
    waiting: input.review.slice(0, 25).map((r) => ({ client: r.clientName, title: r.title })),
  };
}

export function digestToText(d: Digest): string {
  const lines = [
    `Mellox AI · Client report — ${d.dateLabel}`,
    "",
    `Clients: ${d.clients} (${d.active} active)`,
    `To review: ${d.review} · Ready to post: ${d.ready} · Scheduled (14 days): ${d.scheduled}`,
    `Published (14 days): ${d.published14}${d.failed ? ` · Failed: ${d.failed}` : ""}`,
    "",
    "By client:",
    ...d.perClient.map(
      (c) =>
        `  • ${c.name} — ${c.health} · ${c.review} to review · ${c.scheduled} scheduled · ${c.published} published`,
    ),
  ];
  if (d.waiting.length) {
    lines.push("", "Waiting for review:", ...d.waiting.map((w) => `  • [${w.client}] ${w.title}`));
  }
  return lines.join("\n");
}

export function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  // Neutralise spreadsheet formulas in user-authored titles.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function digestToCsv(d: Digest): string {
  const rows: (string | number)[][] = [
    ["Client", "Health", "To review", "Scheduled", "Published"],
    ...d.perClient.map((c) => [c.name, c.health, c.review, c.scheduled, c.published]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
