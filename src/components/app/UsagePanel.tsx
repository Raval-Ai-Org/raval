"use client";

// Plan & usage — the workspace's REAL metered AI usage against its plan
// (GET /api/usage). Replaces the "Upgrade plan" dead end while billing is out
// of scope, and the cosmetic browser-side token counter: spend today and this
// month vs the plan's ceilings, image/video quotas, cache hit rate and savings.
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { authedFetch, getActiveWorkspaceId } from "@/lib/authed-fetch";

type Usage = {
  plan: string;
  status: "ok" | "warn" | "degrade" | "block";
  notice: string | null;
  spend: {
    todayUsd: number;
    monthUsd: number;
    dailyLimitUsd: number;
    monthlyLimitUsd: number;
    dailyUsed: number;
    monthlyUsed: number;
  };
  quotas: { images: { used: number; limit: number }; videos: { used: number; limit: number } };
  cache: {
    monthCalls: number;
    monthCachedCalls: number;
    monthSavedUsd: number;
    hitRates: Array<{ namespace: string; hits: number; misses: number; hitRate: number }>;
  };
};

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency OS",
};

function Meter({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  format: (n: number) => string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      <div className="flex justify-between text-[12.5px]">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const count = (n: number) => String(n);

export function UsagePanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:usage", h as never);
    return () => removeAppEventListener("open:usage", h as never);
  }, []);

  useEffect(() => {
    if (!open) return;
    const workspaceId = getActiveWorkspaceId();
    if (!workspaceId) {
      setError("Select a workspace to see its usage.");
      return;
    }
    setError(null);
    setData(null);
    authedFetch(`/api/usage?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
        setData(json as Usage);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load usage"));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const aiHit = data?.cache.hitRates.find((h) => h.namespace === "ai");
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4"
      onClick={() => setOpen(false)}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-title"
        className="w-full max-w-[460px] rounded-2xl border border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="usage-title" className="text-[15px] font-semibold">
              Plan & usage
            </h2>
            <p className="text-[12px] text-muted-foreground">
              Measured AI usage for this workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {error ? (
          <p className="text-[13px] text-destructive">{error}</p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
              <span className="text-[13px]">
                Plan: <strong>{PLAN_LABEL[data.plan] ?? data.plan}</strong>
              </span>
              <span className="text-[11.5px] text-muted-foreground">Billing is coming soon</span>
            </div>
            {data.notice ? (
              <p
                className={`rounded-lg px-3 py-2 text-[12.5px] ${
                  data.status === "warn"
                    ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {data.notice}
              </p>
            ) : null}
            <Meter
              label="AI spend today"
              used={data.spend.todayUsd}
              limit={data.spend.dailyLimitUsd}
              format={usd}
            />
            <Meter
              label="AI spend this month"
              used={data.spend.monthUsd}
              limit={data.spend.monthlyLimitUsd}
              format={usd}
            />
            <Meter
              label="Images this month"
              used={data.quotas.images.used}
              limit={data.quotas.images.limit}
              format={count}
            />
            <Meter
              label="Videos this month"
              used={data.quotas.videos.used}
              limit={data.quotas.videos.limit}
              format={count}
            />
            <div className="rounded-xl border border-border px-3 py-2 text-[12.5px]">
              <div className="flex justify-between">
                <span>Answers served from cache (this month)</span>
                <span>
                  {data.cache.monthCachedCalls} of {data.cache.monthCalls}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Estimated saving</span>
                <span>{usd(data.cache.monthSavedUsd)}</span>
              </div>
              {aiHit && aiHit.hits + aiHit.misses > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Cache hit rate (7 days, all workspaces)</span>
                  <span>{Math.round(aiHit.hitRate * 100)}%</span>
                </div>
              ) : null}
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Near a limit you'll see a warning; past it, text answers switch to an economy model
              and new images or videos pause until the next period.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
