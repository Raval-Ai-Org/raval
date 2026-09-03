"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { supabase } from "@/integrations/supabase/client";
import { refreshSuggestions } from "@/lib/insights.functions";

export type StudioSuggestionAccent = "indigo" | "blue" | "green" | "violet" | "rose" | "amber";

export type StudioSuggestion = {
  id: string;
  label: string;
  hint: string;
  accent: StudioSuggestionAccent;
  /** Lucide-like icon name we render via the brand icons re-exports */
  icon: "Sparkles" | "Brain" | "Calendar" | "Search" | "Wand2" | "Mail" | "Share2" | "FileText";
  /** Fired when the user clicks. */
  run: () => void;
};

function hasBrandDna(wsId: string): boolean {
  try {
    for (const k of [`brand-dna:v3:${wsId}`, `brand-dna:v2:${wsId}`, `brand-dna:${wsId}`]) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const b = JSON.parse(raw) as Record<string, unknown>;
      if (b && (b.brandName || b.oneLiner || b.websiteUrl)) return true;
    }
  } catch {}
  return false;
}

function hasRecentAudit(wsId: string): boolean {
  try {
    const raw = localStorage.getItem(`geo:lastRun:${wsId}`);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < 1000 * 60 * 60 * 24 * 7; // 7 days
  } catch {
    return false;
  }
}

function fire(event: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

function openCanvas(type: string) {
  fire("open:canvas", { type });
}

function chatPrefill(prompt: string) {
  fire("chat:prefill", prompt);
  fire("chat:focus");
}

export function useStudioSuggestions() {
  const [items, setItems] = useState<StudioSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const wsId = typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
    if (!wsId) {
      setItems([]);
      setLoading(false);
      return;
    }

    const weekAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString();
    const nextWeek = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    const [publishedRecent, scheduledNext, draftsCount, blogCount, sharesCount] = await Promise.all(
      [
        supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .eq("status", "published")
          .gte("updated_at", weekAgo),
        supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .eq("status", "scheduled")
          .lte("scheduled_at", nextWeek),
        supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .eq("status", "draft"),
        supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId)
          .in("kind", ["blog", "brief"]),
        supabase
          .from("client_shares")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", wsId),
      ],
    );

    const dnaOk = hasBrandDna(wsId);
    const auditOk = hasRecentAudit(wsId);

    const out: StudioSuggestion[] = [];

    if (!dnaOk) {
      out.push({
        id: "brand-dna",
        label: "Capture your Brand DNA",
        hint: "30s · unlocks personalised drafts",
        accent: "violet",
        icon: "Brain",
        run: () => fire("open:brand-dna"),
      });
    }

    if (!auditOk) {
      out.push({
        id: "geo-audit",
        label: "Run AI visibility audit",
        hint: "40-point GEO / AEO scan",
        accent: "blue",
        icon: "Search",
        run: () => fire("geo:run-audit"),
      });
    }

    if ((publishedRecent.count ?? 0) < 3) {
      out.push({
        id: "plan-week",
        label: "Plan this week's content",
        hint: `${publishedRecent.count ?? 0} published in last 7 days`,
        accent: "green",
        icon: "Calendar",
        run: () =>
          chatPrefill(
            "Plan this week's content — 5 posts across LinkedIn and Instagram, grounded in our Brand DNA.",
          ),
      });
    }

    if ((scheduledNext.count ?? 0) === 0) {
      out.push({
        id: "schedule-next",
        label: "Schedule next week's posts",
        hint: "Calendar is empty for next 7 days",
        accent: "indigo",
        icon: "Calendar",
        run: () =>
          chatPrefill(
            "Schedule 5 posts for next week across LinkedIn and Instagram with the best times for our audience.",
          ),
      });
    }

    if ((draftsCount.count ?? 0) >= 5) {
      out.push({
        id: "review-drafts",
        label: `Review ${draftsCount.count} drafts`,
        hint: "Approve or polish to keep momentum",
        accent: "amber",
        icon: "Wand2",
        run: () => fire("open:content-calendar"),
      });
    }

    if ((blogCount.count ?? 0) === 0) {
      out.push({
        id: "first-seo-brief",
        label: "Draft your first SEO brief",
        hint: "Target an AEO-friendly question",
        accent: "blue",
        icon: "FileText",
        run: () => openCanvas("seo-brief"),
      });
    }

    if ((sharesCount.count ?? 0) === 0) {
      out.push({
        id: "first-share",
        label: "Share work with a client",
        hint: "Get approvals in one link",
        accent: "rose",
        icon: "Share2",
        run: () => fire("open:client-portal"),
      });
    }

    // Always-on gentle nudge if everything else is clear
    if (out.length === 0) {
      out.push({
        id: "ideate",
        label: "Brainstorm a campaign",
        hint: "Spin up 5 angles in 30s",
        accent: "indigo",
        icon: "Sparkles",
        run: () =>
          chatPrefill(
            "Brainstorm 5 campaign angles for our next launch, grounded in our Brand DNA.",
          ),
      });
    }

    setItems(out.slice(0, 5));
    setLoading(false);
  }, []);

  const callAi = useServerFn(refreshSuggestions);
  const [aiItems, setAiItems] = useState<StudioSuggestion[]>([]);
  const aiLoadingRef = useRef(false);

  type CachedAiItem = Omit<StudioSuggestion, "run"> & { intent: string; prompt: string };

  const loadAi = useCallback(
    async (force = false) => {
      const wsId =
        typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
      if (!wsId || aiLoadingRef.current) return;
      // 15-minute cache. We rebuild `run` from stored `intent`+`prompt` because
      // functions don't survive JSON.stringify — hydrating a raw cached
      // StudioSuggestion would crash on click with "s.run is not a function".
      try {
        if (!force) {
          const raw = localStorage.getItem(`studio:suggestions:${wsId}`);
          if (raw) {
            const cached = JSON.parse(raw) as { at: number; items: CachedAiItem[] };
            if (Date.now() - cached.at < 15 * 60 * 1000 && Array.isArray(cached.items)) {
              setAiItems(
                cached.items.map((c) => ({
                  id: c.id,
                  label: c.label,
                  hint: c.hint,
                  accent: c.accent,
                  icon: c.icon,
                  run: () => runIntent(c.intent, c.prompt),
                })),
              );
              return;
            }
          }
        }
      } catch {}

      aiLoadingRef.current = true;
      try {
        const brandContext = (() => {
          try {
            for (const k of [`brand-dna:v3:${wsId}`, `brand-dna:v2:${wsId}`, `brand-dna:${wsId}`]) {
              const raw = localStorage.getItem(k);
              if (!raw) continue;
              const b = JSON.parse(raw) as Record<string, unknown>;
              const lines: string[] = [];
              for (const f of [
                "brandName",
                "oneLiner",
                "industry",
                "products",
                "audience",
                "voice",
                "values",
              ]) {
                const v = b[f];
                if (typeof v === "string" && v.trim()) lines.push(`${f}: ${v}`);
              }
              return lines.join("\n");
            }
          } catch {}
          return "";
        })();

        const res = await callAi({
          data: { workspaceId: wsId, brandContext, max: 5 },
        });
        const raw = (res.suggestions ?? []).map((s, i) => ({
          id: `ai-${i}-${s.intent}`,
          label: s.label,
          hint: s.hint,
          accent: aiAccentFor(s.intent),
          icon: aiIconFor(s.intent),
          intent: s.intent,
          prompt: s.prompt,
        }));
        const mapped: StudioSuggestion[] = raw.map((c) => ({
          id: c.id,
          label: c.label,
          hint: c.hint,
          accent: c.accent,
          icon: c.icon,
          run: () => runIntent(c.intent, c.prompt),
        }));
        setAiItems(mapped);
        try {
          localStorage.setItem(
            `studio:suggestions:${wsId}`,
            JSON.stringify({ at: Date.now(), items: raw }),
          );
        } catch {}
      } catch {
        /* silent — deterministic items already render */
      } finally {
        aiLoadingRef.current = false;
      }
    },
    [callAi],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().catch(() => {
      if (!cancelled) setLoading(false);
    });
    loadAi(false).catch(() => {});
    const onChange = () => {
      load().catch(() => {});
    };
    const onSignalChange = () => {
      loadAi(true).catch(() => {});
    };
    window.addEventListener("content:changed", onChange);
    window.addEventListener("brand-dna:saved", onChange);
    window.addEventListener("brand-dna:saved", onSignalChange);
    window.addEventListener("geo:audit-complete", onChange);
    window.addEventListener("geo:audit-complete", onSignalChange);
    const t = window.setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 120000);
    const onVis = () => {
      if (!document.hidden) load().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.removeEventListener("content:changed", onChange);
      window.removeEventListener("brand-dna:saved", onChange);
      window.removeEventListener("brand-dna:saved", onSignalChange);
      window.removeEventListener("geo:audit-complete", onChange);
      window.removeEventListener("geo:audit-complete", onSignalChange);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, loadAi]);

  const refresh = useCallback(async () => {
    await load();
    await loadAi(true);
  }, [load, loadAi]);

  // Merge: deterministic first (high-confidence signals), then AI extras.
  const merged = [
    ...items,
    ...aiItems.filter((a) => !items.some((i) => i.label === a.label)),
  ].slice(0, 8);

  return { items: merged, loading, reload: load, refresh, aiItems };
}

/* ---- intent helpers ---- */
function aiAccentFor(intent: string): StudioSuggestionAccent {
  switch (intent) {
    case "geo-audit":
      return "blue";
    case "brand-dna":
      return "violet";
    case "plan-week":
    case "schedule":
      return "indigo";
    case "review-drafts":
      return "amber";
    case "seo-brief":
    case "blog":
      return "blue";
    case "share":
      return "rose";
    case "social":
      return "green";
    case "email":
      return "blue";
    default:
      return "indigo";
  }
}
function aiIconFor(intent: string): StudioSuggestion["icon"] {
  switch (intent) {
    case "geo-audit":
      return "Search";
    case "brand-dna":
      return "Brain";
    case "plan-week":
    case "schedule":
      return "Calendar";
    case "review-drafts":
      return "Wand2";
    case "seo-brief":
    case "blog":
      return "FileText";
    case "share":
      return "Share2";
    case "email":
      return "Mail";
    case "social":
      return "Share2";
    default:
      return "Sparkles";
  }
}
function runIntent(intent: string, prompt: string) {
  switch (intent) {
    case "geo-audit":
      fire("geo:run-audit");
      return;
    case "brand-dna":
      fire("open:brand-dna");
      return;
    case "review-drafts":
      fire("open:content-calendar");
      return;
    case "share":
      fire("open:client-portal");
      return;
    case "seo-brief":
      window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type: "seo-brief" } }));
      return;
    default:
      chatPrefill(prompt);
  }
}
