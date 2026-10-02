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

function installBackend(): () => void {
  let items = seed();
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
    const restore = installBackend();
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
