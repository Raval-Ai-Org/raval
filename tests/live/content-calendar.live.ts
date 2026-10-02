// Live check of the Content Calendar through a RUNNING dev server and the real
// Supabase project (reads .env): a temporary user and brand call the same RPC
// endpoints the browser does, with their own sign-in, so authentication,
// row-level security, the lifecycle rules and billing are what is tested.
//
// Always (no AI spend): a post planned for a day stays on that day; moving it
// never schedules, approves or un-approves it; a stranger cannot move it.
//
// With CALENDAR_LIVE_PLAN=yes (paid, a few cents): Mellox plans one week of
// three posts and each lands on the day the planner chose for it.
//
// Needs the app running (default http://localhost:8080, or LIVE_APP_URL).
// Everything it creates is deleted.
//   npx vitest run --config vitest.live.config.ts tests/live/content-calendar.live.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, entryFromContent, fmtYMD } from "@/lib/calendar/model";
import { buildPlanSlots } from "@/lib/calendar/planner";
import type { ContentItem } from "@/server/fns/content";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE = (process.env.LIVE_APP_URL ?? "http://localhost:8080").replace(/\/$/, "");
const PAID = process.env.CALENDAR_LIVE_PLAN === "yes";
const configured =
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_PUBLISHABLE_KEY;

type Actor = { id: string; token: string };

let admin: SupabaseClient;
let owner: Actor;
let stranger: Actor;
let workspaceId = "";
let reachable = false;
const createdUsers: string[] = [];

async function makeActor(tag: string): Promise<Actor> {
  const { createClient } = await import("@supabase/supabase-js");
  const email = `calendar-live-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUsers.push(data.user.id);
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !session.session) throw new Error(`sign in failed: ${signInError?.message}`);
  return { id: data.user.id, token: session.session.access_token };
}

async function rpc<T>(
  actor: Actor,
  fn: string,
  data: unknown,
): Promise<{ status: number; result?: T; error?: string }> {
  const res = await fetch(`${BASE}/api/rpc/content/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${actor.token}`,
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify({ data }),
  });
  const payload = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  return { status: res.status, result: payload.result, error: payload.error };
}

(configured ? describe : describe.skip)("Content Calendar (live)", () => {
  beforeAll(async () => {
    reachable = await fetch(`${BASE}/api/health`)
      .then(() => true)
      .catch(() => false);
    if (!reachable) return;
    const mod = await import("@/integrations/supabase/client.server");
    admin = mod.supabaseAdmin as unknown as SupabaseClient;
    owner = await makeActor("owner");
    stranger = await makeActor("stranger");
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    const ws = await createOrGetWorkspace({
      userId: owner.id,
      name: "Calendar Live Coffee",
      websiteUrl: `https://calendar-live-${randomUUID().slice(0, 8)}.example.com`,
      idempotencyKey: randomUUID(),
    });
    workspaceId = ws.id;
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    if (workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("keeps a planned post on its day, and moving it changes nothing else", async (ctx) => {
    if (!reachable) return ctx.skip();
    const planned = fmtYMD(addDays(new Date(), 9));
    const moved = fmtYMD(addDays(new Date(), 12));

    const created = await rpc<ContentItem>(owner, "createContentItem", {
      workspaceId,
      kind: "post",
      channel: "facebook",
      title: "Live calendar post",
      body: "First line.\n\nThe rest.",
      status: "draft",
      meta: { source: "calendar", calendar_date: planned, calendar_time: "13:00" },
    });
    expect(created.status, created.error).toBe(200);
    const id = created.result!.id;

    // Reloading the list puts it on the planned day (it used to jump to "today").
    const listed = await rpc<ContentItem[]>(owner, "listContentItems", { workspaceId });
    expect(listed.status, listed.error).toBe(200);
    const row = listed.result!.find((item) => item.id === id)!;
    expect(entryFromContent(row)).toMatchObject({
      date: planned,
      time: "13:00",
      channel: "facebook",
      status: "draft",
    });

    // An edit does not move it either.
    const edited = await rpc<ContentItem>(owner, "updateContentItem", {
      id,
      patch: { body: "First line.\n\nEdited." },
    });
    expect(edited.status, edited.error).toBe(200);
    expect(entryFromContent(edited.result!).date).toBe(planned);

    const approved = await rpc<ContentItem>(owner, "updateContentItem", {
      id,
      patch: { status: "approved" },
    });
    expect(approved.result?.status).toBe("approved");

    // Moving an approved post keeps it approved and does not schedule it.
    const after = await rpc<ContentItem>(owner, "setContentPlanDate", {
      id,
      date: moved,
      time: "18:30",
    });
    expect(after.status, after.error).toBe(200);
    expect(after.result).toMatchObject({ status: "approved", scheduled_at: null });
    expect(entryFromContent(after.result!)).toMatchObject({ date: moved, time: "18:30" });

    // Bad input and strangers are refused.
    expect((await rpc(owner, "setContentPlanDate", { id, date: "2026-02-31" })).status).toBe(400);
    const outsider = await rpc(stranger, "setContentPlanDate", { id, date: planned });
    expect([403, 404]).toContain(outsider.status);
    const still = await rpc<ContentItem[]>(owner, "listContentItems", { workspaceId });
    expect(entryFromContent(still.result!.find((item) => item.id === id)!).date).toBe(moved);

    // A post that is on its way out cannot be moved from the calendar.
    await admin
      .from("content_items")
      .update({ status: "scheduled", scheduled_at: new Date(Date.now() + 864e5).toISOString() })
      .eq("id", id);
    const locked = await rpc(owner, "setContentPlanDate", { id, date: planned });
    expect(locked.status).toBe(409);
    expect(locked.error).toMatch(/Cancel the schedule/);
  });

  it("refuses a plan from someone outside the workspace", async (ctx) => {
    if (!reachable) return ctx.skip();
    const res = await rpc(stranger, "planContentCalendar", {
      workspaceId,
      startDate: fmtYMD(addDays(new Date(), 1)),
      weeks: 1,
      postsPerWeek: 2,
      channels: ["instagram"],
      weekdays: [],
      topics: ["tips"],
      goal: "awareness",
    });
    expect([403, 404]).toContain(res.status);
  });

  (PAID ? it : it.skip)(
    "plans a week of posts, each on the day the planner chose",
    async (ctx) => {
      if (!reachable) return ctx.skip();
      const options = {
        startDate: fmtYMD(addDays(new Date(), 1)),
        weeks: 1,
        postsPerWeek: 3,
        channels: ["instagram", "linkedin"] as ("instagram" | "linkedin")[],
        weekdays: [],
        topics: ["tips", "behind"] as ("tips" | "behind")[],
        industry: "food",
        keyDates: false,
      };
      const res = await rpc<{ items: ContentItem[]; requested: number }>(
        owner,
        "planContentCalendar",
        {
          workspaceId,
          ...options,
          goal: "awareness",
          notes: "We are a small coffee roastery. New single-origin from Peru this month.",
        },
      );
      expect(res.status, res.error).toBe(200);
      const slots = buildPlanSlots(options);
      expect(res.result!.requested).toBe(3);
      expect(res.result!.items).toHaveLength(3);

      const entries = res.result!.items.map(entryFromContent);
      expect(entries.map((e) => `${e.date} ${e.time} ${e.channel}`).sort()).toEqual(
        slots.map((s) => `${s.date} ${s.time} ${s.channel}`).sort(),
      );
      for (const item of res.result!.items) {
        expect(item.status).toBe("draft");
        expect(item.scheduled_at).toBeNull();
        expect((item.title ?? "").length).toBeGreaterThan(3);
        expect((item.body ?? "").length).toBeGreaterThan(60);
        expect(item.body).not.toMatch(/\[brand\]|\[your /i);
      }
      console.log(
        res
          .result!.items.map(
            (i) => `\n— ${i.channel} · ${i.title}\n${i.body}\n${(i.hashtags ?? []).join(" ")}`,
          )
          .join("\n"),
      );
    },
    180_000,
  );
});
