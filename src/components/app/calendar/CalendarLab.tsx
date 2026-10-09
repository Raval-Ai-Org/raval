"use client";

// Development-only visual QA for the Content Calendar: the real component,
// talking to an in-memory stand-in for its server calls. No workspace or
// sign-in needed. Nothing here is reachable in production (see the page).

import { useEffect, useState } from "react";
import { ContentCalendar } from "@/components/app/ContentCalendar";
import { emitAppEvent } from "@/lib/app-events";
import { addDays, fmtYMD, localInstant } from "@/lib/calendar/model";
import { buildPlanSlots, topicLabel, type PlanOptions } from "@/lib/calendar/planner";
import type { ContentItem } from "@/lib/content.functions";
import {
  DEFAULT_STORY_SETTINGS,
  type ActionView,
  type AutopilotView,
} from "@/lib/autopilot/contracts";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

function uid(): string {
  return crypto.randomUUID();
}

function item(over: Partial<ContentItem>): ContentItem {
  const now = new Date().toISOString();
  return {
    id: uid(),
    workspace_id: WORKSPACE_ID,
    agent: "spark",
    kind: "post",
    channel: "instagram",
    title: "Untitled post",
    body: null,
    hashtags: [],
    media_url: null,
    status: "draft",
    scheduled_at: null,
    metrics: null,
    meta: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
}

function seed(): ContentItem[] {
  const day = (n: number) => fmtYMD(addDays(new Date(), n));
  const planned = (n: number, time: string, extra: Record<string, string> = {}) => ({
    source: "calendar-generator",
    calendar_date: day(n),
    calendar_time: time,
    ...extra,
  });
  return [
    item({
      title: "Three ways to keep oat milk fresh",
      body: "Most people store it wrong.\n\nKeep it sealed, keep it cold, and shake before you pour. Which one do you forget?",
      hashtags: ["#oatmilk", "#tips"],
      meta: planned(0, "11:00", { format: "Carousel", pillar: "Tips and how-tos" }),
    }),
    item({
      channel: "linkedin",
      title: "What we learned opening our second roastery",
      body: "It took twice as long as we planned.\n\nHere is what we would do differently.",
      status: "approved",
      meta: planned(1, "08:30", { format: "Post", pillar: "Behind the scenes" }),
    }),
    item({
      channel: "x",
      title: "Autumn menu is live",
      body: "Pumpkin, cinnamon, and a new single-origin from Peru. In store from today.",
      status: "scheduled",
      scheduled_at: localInstant(day(2), "09:00"),
    }),
    item({
      channel: "facebook",
      title: "Meet Sam, our head roaster",
      body: "Sam has roasted every bag we have sold since 2019.",
      status: "pending",
      meta: planned(3, "13:00", { format: "Post", pillar: "Behind the scenes" }),
    }),
    item({
      channel: "blog",
      kind: "blog",
      title: "How to brew better coffee at home",
      body: "Start with fresh beans and a scale.\n\n## Grind\n## Water\n## Time",
      meta: planned(5, "10:00", { format: "Article", pillar: "Tips and how-tos" }),
    }),
    item({
      channel: "tiktok",
      title: "A day at the roastery in 20 seconds",
      body: "From green beans to your cup.",
      status: "published",
      scheduled_at: localInstant(day(-3), "19:00"),
    }),
    item({
      channel: "email",
      kind: "email",
      title: "Your October coffee picks",
      body: "Hi there,\n\nThree new roasts landed this week.",
      status: "failed",
      meta: planned(-1, "10:00", { format: "Email" }),
    }),
  ];
}

/** `?autopilot=off` hides it, `?autopilot=paused` pauses it; on by default. */
type LabAutopilot = "on" | "paused" | "off";

function action(over: Partial<ActionView>): ActionView {
  return {
    id: uid(),
    kind: "content",
    status: "planned",
    plannedFor: null,
    platform: "instagram",
    contentType: "social",
    title: "",
    brief: "",
    reason: "",
    opportunityId: null,
    contentItemIds: [],
    creditsCharged: 0,
    approvedVia: null,
    error: null,
    metrics: null,
    updatedAt: new Date().toISOString(),
    nextStepAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    ...over,
  };
}

/** A running program: some pieces written (they are posts), some only planned. */
function autopilotView(items: ContentItem[], mode: LabAutopilot): AutopilotView {
  const at = (n: number, time: string) => localInstant(fmtYMD(addDays(new Date(), n)), time);
  const written = (title: string) => items.find((i) => i.title === title)?.id;
  const ids = (title: string) => {
    const id = written(title);
    return id ? [id] : [];
  };
  return {
    enabled: true,
    fullAvailable: true,
    canEdit: true,
    canManage: true,
    program: {
      id: uid(),
      status: mode === "paused" ? "paused" : "running",
      pauseReason: mode === "paused" ? "user" : null,
      mode: "autopilot",
      goal: "awareness",
      goalNote: "",
      platforms: ["instagram", "linkedin"],
      contentTypes: ["social", "carousel"],
      postsPerWeek: 4,
      weekdays: [1, 2, 3, 4, 5],
      timezone: "UTC",
      startsOn: fmtYMD(addDays(new Date(), -7)),
      endsOn: fmtYMD(addDays(new Date(), 21)),
      creditCapPerWeek: 200,
      videoCapPerWeek: 0,
      actOnOpportunities: false,
      strategy: null,
      automations: ["geo_scan"],
      stories: DEFAULT_STORY_SETTINGS,
      week: 2,
      totalWeeks: 4,
    },
    budget: { creditsUsed: 40, creditCap: 200, videosUsed: 0, videoCap: 0 },
    proposed: [],
    approvals: [
      action({
        status: "needs_approval",
        plannedFor: at(3, "13:00"),
        platform: "facebook",
        title: "Meet Sam, our head roaster",
        contentItemIds: ids("Meet Sam, our head roaster"),
      }),
    ],
    upcoming: [
      action({
        status: "approved",
        plannedFor: at(1, "08:30"),
        platform: "linkedin",
        title: "What we learned opening our second roastery",
        contentItemIds: ids("What we learned opening our second roastery"),
      }),
      action({
        status: "generating",
        plannedFor: at(2, "17:00"),
        platform: "instagram",
        contentType: "carousel",
        title: "Five signs your beans are stale",
      }),
      action({
        status: "planned",
        plannedFor: at(6, "09:00"),
        platform: "linkedin",
        title: "Why we pay growers above market price",
      }),
      action({
        status: "planned",
        plannedFor: at(8, "11:00"),
        platform: "instagram",
        contentType: "image",
        title: "The new Peru single-origin, up close",
      }),
      action({
        status: "planned",
        plannedFor: at(9, "09:00"),
        platform: "twitter",
        title: "A quick brew tip for cold mornings",
      }),
    ],
    finished: [],
    failed: [],
    opportunities: [],
    events: [],
    connectedPlatforms: ["instagram", "linkedin"],
    readiness: [],
    learnings: [],
    tasks: [],
    nextPlanAt: null,
    visibility: null,
    site: null,
    week: { posted: 0, views: 0, auto: 0 },
    stories: null,
  };
}

function installBackend(mode: LabAutopilot): () => void {
  let items = seed();
  let autopilot = mode;
  const original = window.fetch;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const patchItem = (id: string, patch: Partial<ContentItem>) => {
    items = items.map((i) =>
      i.id === id ? { ...i, ...patch, updated_at: new Date().toISOString() } : i,
    );
    return items.find((i) => i.id === id);
  };

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.origin).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const data = body.data ?? {};

    if (path.startsWith("/api/rpc/content/")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      switch (path.split("/").pop()) {
        case "listContentItems":
          return json({ result: items });
        case "createContentItem": {
          const created = item({ ...data, workspace_id: WORKSPACE_ID });
          items = [...items, created];
          return json({ result: created });
        }
        case "updateContentItem": {
          const { status, ...rest } = data.patch ?? {};
          const current = items.find((i) => i.id === data.id);
          // Mirrors the server: editing an approved post sends it back to draft.
          const next =
            status ?? (current?.status === "approved" && Object.keys(rest).length ? "draft" : null);
          return json({
            result: patchItem(data.id, { ...rest, ...(next ? { status: next } : {}) }),
          });
        }
        case "deleteContentItem":
          items = items.filter((i) => i.id !== data.id);
          return json({ result: { ok: true } });
        case "setContentPlanDate": {
          const current = items.find((i) => i.id === data.id);
          return json({
            result: patchItem(data.id, {
              meta: {
                ...((current?.meta as Record<string, string> | null) ?? {}),
                calendar_date: data.date,
                ...(data.time ? { calendar_time: data.time } : {}),
              },
            }),
          });
        }
        case "regenerateContentItem": {
          await new Promise((resolve) => setTimeout(resolve, 900));
          const current = items.find((i) => i.id === data.id);
          return json({
            result: patchItem(data.id, {
              body: `A fresh take.\n\n${current?.body ?? ""}`.trim(),
            }),
          });
        }
        case "planContentCalendar": {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const slots = buildPlanSlots(data as PlanOptions);
          const created = slots.map((slot) =>
            item({
              channel: slot.channel,
              kind: slot.channel === "blog" ? "blog" : slot.channel === "email" ? "email" : "post",
              title: slot.moment
                ? `${slot.moment.name}: ${topicLabel(slot.topic)}`
                : `${topicLabel(slot.topic)} · sample ${slot.index + 1}`,
              body: "Sample hook line.\n\nSample caption written for this slot.",
              hashtags: slot.channel === "blog" || slot.channel === "email" ? [] : ["#sample"],
              meta: {
                source: "calendar-generator",
                calendar_date: slot.date,
                calendar_time: slot.time,
                format: slot.format,
                pillar: topicLabel(slot.topic),
              },
            }),
          );
          items = [...items, ...created];
          return json({ result: { items: created, requested: slots.length } });
        }
      }
    }
    if (path.startsWith("/api/rpc/autopilot/")) {
      const live = autopilot !== "off";
      switch (path.split("/").pop()) {
        case "getAutopilotStatus":
          return json({
            result: {
              enabled: true,
              status: !live ? null : autopilot === "paused" ? "paused" : "running",
              waiting: 1,
            },
          });
        case "getAutopilot":
          return json({ result: autopilotView(items, autopilot) });
        case "setAutopilotPaused":
          autopilot = data.paused ? "paused" : "on";
          return json({ result: { ok: true } });
        default:
          return json({ result: { ok: true } });
      }
    }
    if (path === "/api/sdr/status") {
      return json({
        enabled: true,
        canPublish: true,
        role: "owner",
        provider: "postforme",
        platforms: ["linkedin", "twitter", "instagram", "facebook", "threads", "tiktok", "youtube"],
      });
    }
    if (path === "/api/sdr/schedule") {
      const results = (body.items ?? []).map(
        (s: { contentItemId: string; scheduledAt: string }) => {
          patchItem(s.contentItemId, { status: "scheduled", scheduled_at: s.scheduledAt });
          return {
            contentItemId: s.contentItemId,
            status: "publishing",
            scheduledAt: s.scheduledAt,
          };
        },
      );
      return json({ results });
    }
    if (path === "/api/sdr/cancel") {
      patchItem(body.contentItemId, { status: "approved", scheduled_at: null });
      return json({});
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

export function CalendarLab() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("autopilot");
    const restore = installBackend(asked === "off" || asked === "paused" ? asked : "on");
    setReady(true);
    return restore;
  }, []);

  // The calendar listens for this once it has mounted.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => emitAppEvent("open:content-calendar"), 50);
    return () => window.clearTimeout(timer);
  }, [ready]);

  return (
    <main data-mellox-app className="grid min-h-dvh place-items-center bg-background p-6">
      <button
        type="button"
        onClick={() => emitAppEvent("open:content-calendar")}
        className="rounded-full border border-border px-4 py-2 text-sm"
      >
        Open calendar
      </button>
      {ready && <ContentCalendar workspaceId={WORKSPACE_ID} />}
    </main>
  );
}
