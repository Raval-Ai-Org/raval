// Pure rules behind the admin "pulse": who is using Mellox, for how long, what
// they were doing and where it went wrong. Every number is counted from stored
// rows (AI calls, Studio jobs, workspaces, balances); nothing is estimated
// except active time, which is labelled as an estimate wherever it is shown.

import type { AdminPulse, AdminPulseCustomer, AdminPulseError } from "./types";

/** Two actions further apart than this start a new visit. */
export const VISIT_GAP_MS = 20 * 60_000;
/** A visit with a single action still counts as this long. */
export const VISIT_FLOOR_MS = 2 * 60_000;
export const PULSE_DAYS = 14;

/**
 * Minutes a person spent working, estimated from the times of their actions:
 * actions closer than VISIT_GAP_MS belong to one visit; each visit lasts from
 * its first to its last action plus VISIT_FLOOR_MS.
 */
export function activeMinutes(times: number[]): number {
  if (!times.length) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  let total = 0;
  let start = sorted[0];
  let last = sorted[0];
  for (const time of sorted.slice(1)) {
    if (time - last > VISIT_GAP_MS) {
      total += last - start + VISIT_FLOOR_MS;
      start = time;
    }
    last = time;
  }
  total += last - start + VISIT_FLOOR_MS;
  return Math.round(total / 60_000);
}

const ACTIVITY_LABELS: Array<[RegExp, string]> = [
  [/^studio\.video|^ugc|video/, "Making a video"],
  [/^studio\.carousel/, "Making a carousel"],
  [/^studio\.(image|hero|post|meme|plan)|^studio\.motion/, "Making a post"],
  [/^studio\.(transcribe|naturalize)/, "Polishing a piece"],
  [/^studio/, "Working in Studio"],
  [/^chat|^coach/, "Chatting with Mox"],
  [/^brand-extract|^brand-visuals|^brand/, "Reading their brand"],
  [/^geo/, "AI visibility"],
  [/^audience/, "Audience"],
  [/^competitor/, "Competitors"],
  [/^market/, "Market research"],
  [/^strategy/, "Building a strategy"],
  [/^campaign/, "Planning a campaign"],
  [/^autopilot/, "Autopilot"],
  [/^articles|^content/, "Writing an article"],
  [/^community/, "Communities"],
  [/^experiments/, "Experiments"],
  [/^links/, "Backlinks"],
  [/^memory/, "Memory"],
  [/^social/, "Social accounts"],
  [/^guardrails/, "Safety check"],
  [/^agent/, "Agents"],
];

/** A plain-English name for an AI route label or a Studio job type. */
export function activityLabel(route: string | null | undefined): string {
  const value = (route ?? "").trim().toLowerCase();
  if (!value) return "Using Mellox";
  for (const [pattern, label] of ACTIVITY_LABELS) if (pattern.test(value)) return label;
  const words = value.split(/[._-]+/).filter(Boolean);
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The readable part of a stored error: a message, a reason or a category. */
export function errorText(error: unknown): string {
  if (!error) return "Failed without a reason";
  if (typeof error === "string") return error.slice(0, 240);
  if (typeof error === "object") {
    const row = error as Record<string, unknown>;
    for (const key of ["message", "reason", "detail", "error", "category", "code"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
    }
  }
  return "Failed without a reason";
}

export function dayKey(value: string | number | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** The last `days` calendar days (UTC), oldest first, ending today. */
export function dayRange(now: Date, days = PULSE_DAYS): string[] {
  const out: string[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let index = days - 1; index >= 0; index -= 1) {
    out.push(new Date(today - index * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export type PulseInput = {
  now: Date;
  users: Array<{ id: string; name: string | null; email: string | null; createdAt: string }>;
  accounts: Array<{
    ownerUserId: string;
    planId: string;
    planLabel: string;
    status: string;
    creditsUnits: number;
    allowanceUnits: number;
  }>;
  workspaces: Array<{ id: string; name: string; ownerId: string; createdAt: string }>;
  /** AI calls in the window. */
  calls: Array<{
    userId: string | null;
    workspaceId: string | null;
    route: string;
    status: string;
    at: string;
  }>;
  /** Studio jobs in the window. */
  jobs: Array<{
    id: string;
    userId: string | null;
    workspaceId: string;
    type: string;
    title: string | null;
    status: string;
    error: unknown;
    at: string;
  }>;
  /** Plan order for the plan mix (ids). */
  planOrder: string[];
  planLabels: Record<string, string>;
};

const WEEK_MS = 7 * 86_400_000;

export function buildPulse(
  input: PulseInput,
): Omit<AdminPulse, "generatedAt" | "truncated" | "feed"> {
  const now = input.now.getTime();
  const days = dayRange(input.now);
  const series = new Map(
    days.map((day) => [
      day,
      { day, signups: 0, workspaces: 0, pieces: 0, errors: 0, activeUsers: 0 },
    ]),
  );
  const activeByDay = new Map<string, Set<string>>();

  const users = new Map(input.users.map((user) => [user.id, user]));
  const accounts = new Map(input.accounts.map((account) => [account.ownerUserId, account]));
  const workspaceName = new Map(input.workspaces.map((ws) => [ws.id, ws.name]));
  const workspacesByOwner = new Map<string, number>();
  for (const ws of input.workspaces) {
    workspacesByOwner.set(ws.ownerId, (workspacesByOwner.get(ws.ownerId) ?? 0) + 1);
    const point = series.get(dayKey(ws.createdAt));
    if (point) point.workspaces += 1;
  }
  for (const user of input.users) {
    const point = series.get(dayKey(user.createdAt));
    if (point) point.signups += 1;
  }

  type Tally = {
    times: number[];
    weekTimes: number[];
    actions7d: number;
    errors7d: number;
    pieces7d: number;
    lastAt: number;
    lastWhat: string;
    doing: Map<string, number>;
  };
  const tallies = new Map<string, Tally>();
  const tally = (userId: string): Tally => {
    let row = tallies.get(userId);
    if (!row) {
      row = {
        times: [],
        weekTimes: [],
        actions7d: 0,
        errors7d: 0,
        pieces7d: 0,
        lastAt: 0,
        lastWhat: "",
        doing: new Map(),
      };
      tallies.set(userId, row);
    }
    return row;
  };
  const touch = (userId: string, at: number, what: string) => {
    const row = tally(userId);
    row.times.push(at);
    const day = dayKey(at);
    if (!activeByDay.has(day)) activeByDay.set(day, new Set());
    activeByDay.get(day)!.add(userId);
    if (now - at <= WEEK_MS) {
      row.weekTimes.push(at);
      row.actions7d += 1;
      row.doing.set(what, (row.doing.get(what) ?? 0) + 1);
    }
    if (at > row.lastAt) {
      row.lastAt = at;
      row.lastWhat = what;
    }
  };

  const errors: AdminPulseError[] = [];
  const errorsByWhat = new Map<string, number>();
  const who = (userId: string | null) => {
    const user = userId ? users.get(userId) : undefined;
    return { userId, name: user?.name ?? null, email: user?.email ?? null };
  };

  for (const call of input.calls) {
    const at = new Date(call.at).getTime();
    if (!Number.isFinite(at)) continue;
    const what = activityLabel(call.route);
    if (call.userId) touch(call.userId, at, what);
    if (call.status === "error") {
      const point = series.get(dayKey(at));
      if (point) point.errors += 1;
      if (now - at <= WEEK_MS) {
        errorsByWhat.set(what, (errorsByWhat.get(what) ?? 0) + 1);
        if (call.userId) tally(call.userId).errors7d += 1;
        errors.push({
          id: `call:${call.userId ?? "system"}:${at}:${call.route}`,
          source: "ai",
          ...who(call.userId),
          workspaceId: call.workspaceId,
          workspaceName: call.workspaceId ? (workspaceName.get(call.workspaceId) ?? null) : null,
          what,
          detail: call.route,
          message: "The AI provider returned an error",
          at: new Date(at).toISOString(),
        });
      }
    }
  }

  for (const job of input.jobs) {
    const at = new Date(job.at).getTime();
    if (!Number.isFinite(at)) continue;
    const what = activityLabel(`studio.${job.type}`);
    if (job.userId) touch(job.userId, at, what);
    const point = series.get(dayKey(at));
    if (job.status === "succeeded") {
      if (point) point.pieces += 1;
      if (job.userId && now - at <= WEEK_MS) tally(job.userId).pieces7d += 1;
    }
    if (job.status === "failed") {
      if (point) point.errors += 1;
      if (now - at <= WEEK_MS) {
        errorsByWhat.set(what, (errorsByWhat.get(what) ?? 0) + 1);
        if (job.userId) tally(job.userId).errors7d += 1;
        errors.push({
          id: `job:${job.id}`,
          source: "studio",
          ...who(job.userId),
          workspaceId: job.workspaceId,
          workspaceName: workspaceName.get(job.workspaceId) ?? null,
          what,
          detail: job.title ?? job.type,
          message: errorText(job.error),
          at: new Date(at).toISOString(),
        });
      }
    }
  }

  for (const [day, set] of activeByDay) {
    const point = series.get(day);
    if (point) point.activeUsers = set.size;
  }

  const customers: AdminPulseCustomer[] = input.users.map((user) => {
    const account = accounts.get(user.id);
    const row = tallies.get(user.id);
    const top = row
      ? [...row.doing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      : ([] as Array<[string, number]>);
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      joinedAt: user.createdAt,
      planId: account?.planId ?? "free",
      planLabel: account?.planLabel ?? input.planLabels.free ?? "No plan",
      status: account?.status ?? "none",
      creditsLeft: account ? Math.max(0, account.creditsUnits) : 0,
      creditsAllowance: account?.allowanceUnits ?? 0,
      workspaces: workspacesByOwner.get(user.id) ?? 0,
      activeMinutes7d: row ? activeMinutes(row.weekTimes) : 0,
      activeMinutes14d: row ? activeMinutes(row.times) : 0,
      actions7d: row?.actions7d ?? 0,
      pieces7d: row?.pieces7d ?? 0,
      errors7d: row?.errors7d ?? 0,
      lastActiveAt: row?.lastAt ? new Date(row.lastAt).toISOString() : null,
      lastDoing: row?.lastWhat || null,
      topActivities: top.map(([label, count]) => ({ label, count })),
    };
  });
  customers.sort(
    (a, b) =>
      (b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0) -
        (a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0) ||
      Date.parse(b.joinedAt) - Date.parse(a.joinedAt),
  );

  const planCounts = new Map<string, { accounts: number; creditsLeft: number }>();
  for (const customer of customers) {
    const entry = planCounts.get(customer.planId) ?? { accounts: 0, creditsLeft: 0 };
    entry.accounts += 1;
    entry.creditsLeft += customer.creditsLeft;
    planCounts.set(customer.planId, entry);
  }
  const plans = [
    ...input.planOrder,
    ...[...planCounts.keys()].filter((id) => !input.planOrder.includes(id)),
  ]
    .filter((id) => planCounts.has(id))
    .map((id) => ({
      planId: id,
      label: input.planLabels[id] ?? id,
      accounts: planCounts.get(id)!.accounts,
      creditsLeft: planCounts.get(id)!.creditsLeft,
    }));

  const ownerName = (id: string) => users.get(id)?.name ?? null;
  const ownerEmail = (id: string) => users.get(id)?.email ?? null;
  const newWorkspaces = input.workspaces
    .filter((ws) => now - Date.parse(ws.createdAt) <= 30 * 86_400_000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 60)
    .map((ws) => ({
      id: ws.id,
      name: ws.name,
      ownerId: ws.ownerId,
      ownerName: ownerName(ws.ownerId),
      ownerEmail: ownerEmail(ws.ownerId),
      ownerPlan: accounts.get(ws.ownerId)?.planLabel ?? input.planLabels.free ?? "No plan",
      createdAt: ws.createdAt,
    }));

  errors.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const week = customers.filter(
    (c) => c.lastActiveAt && now - Date.parse(c.lastActiveAt) <= WEEK_MS,
  );
  const paying = customers.filter((c) => c.planId !== "free" && c.status !== "none");

  return {
    totals: {
      users: customers.length,
      newUsers7d: customers.filter((c) => now - Date.parse(c.joinedAt) <= WEEK_MS).length,
      activeUsers7d: week.length,
      activeToday: activeByDay.get(days[days.length - 1])?.size ?? 0,
      payingCustomers: paying.length,
      workspaces: input.workspaces.length,
      newWorkspaces7d: input.workspaces.filter((ws) => now - Date.parse(ws.createdAt) <= WEEK_MS)
        .length,
      creditsLeft: paying.reduce((sum, c) => sum + c.creditsLeft, 0),
      creditsAllowance: paying.reduce((sum, c) => sum + c.creditsAllowance, 0),
      minutes7d: customers.reduce((sum, c) => sum + c.activeMinutes7d, 0),
      errors7d: errors.length,
      errors24h: errors.filter((e) => now - Date.parse(e.at) <= 86_400_000).length,
      pieces7d: customers.reduce((sum, c) => sum + c.pieces7d, 0),
    },
    days: days.map((day) => series.get(day)!),
    plans,
    customers,
    errors: errors.slice(0, 200),
    errorsByWhat: [...errorsByWhat.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    newWorkspaces,
  };
}
