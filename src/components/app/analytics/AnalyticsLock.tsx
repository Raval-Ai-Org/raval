"use client";

// The analytics surface is locked until this workspace has a Google source.
// Behind the lock sits a blurred, inert sketch of the dashboard — plain markup,
// never real numbers — with one card in the middle asking for the one thing
// that is missing. Once a property or site is chosen the lock is gone for
// good: no panel below ever asks to connect again (changing or removing the
// connection lives in Settings → Connections).
import { AlertTriangle, Lock, ShieldCheck } from "@/components/icons";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import type { GoogleConnectionView } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";
import {
  AnalyticsMark,
  ConnectGoogleButton,
  SearchConsoleMark,
  SourcePicker,
} from "./GoogleConnectCard";
import { useGoogleConnection } from "./hooks";

/** What this workspace is missing before analytics can be shown. */
export type AccessState =
  "loading" | "failed" | "unavailable" | "connect" | "reconnect" | "choose" | "open";

export function accessStateOf(view: GoogleConnectionView | undefined): AccessState {
  if (!view) return "loading";
  const conn = view.connection;
  if (!conn) return view.configured ? "connect" : "unavailable";
  if (conn.status !== "active") return "reconnect";
  if (!view.ga4 && !view.gsc) return "choose";
  return "open";
}

/* ── The blurred dashboard behind the lock ─────────────────────────────── */

const SPARK = "M0 46 C 22 40, 34 18, 56 22 S 92 8, 118 14 S 152 34, 180 12 S 218 24, 240 6";

function GhostTile({ w }: { w: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
      <div className="h-2 w-16 rounded-full bg-muted-foreground/25" />
      <div className={cn("mt-3 h-6 rounded-md bg-foreground/15", w)} />
      <div className="mt-2 h-2 w-12 rounded-full bg-primary/40" />
    </div>
  );
}

function GhostRows({ n }: { n: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
      <div className="h-2 w-24 rounded-full bg-muted-foreground/25" />
      <ul className="mt-4 space-y-3">
        {Array.from({ length: n }).map((_, i) => (
          <li key={i} className="space-y-1.5">
            <div
              className="h-2 rounded-full bg-muted-foreground/20"
              style={{ width: `${88 - i * 13}%` }}
            />
            <div className="h-1 rounded-full bg-primary/30" style={{ width: `${72 - i * 14}%` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A silhouette of the real dashboard. Decorative only. */
function LockedPreview() {
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none space-y-4 opacity-60 blur-[7px] saturate-50"
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <GhostTile w="w-20" />
        <GhostTile w="w-14" />
        <GhostTile w="w-24" />
        <GhostTile w="w-16" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
        <div className="h-2 w-28 rounded-full bg-muted-foreground/25" />
        <svg viewBox="0 0 240 56" className="mt-4 h-40 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lock-ghost-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${SPARK} L 240 56 L 0 56 Z`} fill="url(#lock-ghost-fill)" />
          <path
            d={SPARK}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GhostRows n={4} />
        <GhostRows n={4} />
      </div>
    </div>
  );
}

/* ── The card in the middle ────────────────────────────────────────────── */

const SOURCES = [
  { Mark: AnalyticsMark, name: "Google Analytics", what: "Visits, visitors and conversions" },
  { Mark: SearchConsoleMark, name: "Search Console", what: "Clicks, search terms and rankings" },
];

function LockCard({
  title,
  body,
  children,
  tone = "primary",
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
  tone?: "primary" | "warning";
}) {
  return (
    <div className="w-full max-w-md rounded-[1.75rem] border border-border/70 bg-card/85 p-7 text-center shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
      <span
        className={cn(
          "mx-auto grid size-12 place-items-center rounded-2xl ring-1",
          tone === "primary"
            ? "bg-primary/10 text-primary ring-primary/25"
            : "bg-warning/10 text-warning ring-warning/25",
        )}
      >
        {tone === "primary" ? (
          <Lock className="size-5" aria-hidden />
        ) : (
          <AlertTriangle className="size-5" aria-hidden />
        )}
      </span>
      <h2 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {children}
    </div>
  );
}

function SourceList() {
  return (
    <ul className="mt-5 space-y-2 text-left">
      {SOURCES.map(({ Mark, name, what }) => (
        <li
          key={name}
          className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white shadow-sm">
            <Mark className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium">{name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{what}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function LockedScreen({ state, view }: { state: AccessState; view?: GoogleConnectionView }) {
  const ws = useWorkspace();
  const isAdmin = ws.role === "admin" || ws.role === "owner";

  return (
    <div className="relative min-h-[560px] lg:min-h-[calc(100vh-13rem)]">
      <div className="absolute inset-0 overflow-hidden">
        <LockedPreview />
      </div>
      <div className="absolute inset-0 z-10 grid place-items-center bg-background/45 px-4 backdrop-blur-[2px]">
        {state === "unavailable" ? (
          <LockCard
            tone="warning"
            title="Analytics isn't set up"
            body="Google sign-in hasn't been configured on this Mellox server yet."
          />
        ) : state === "failed" ? (
          <LockCard
            tone="warning"
            title="We couldn't check your connection"
            body="Something went wrong on our side. Try again in a moment."
          />
        ) : state === "reconnect" ? (
          <LockCard
            tone="warning"
            title="Google access expired"
            body={
              view?.connection?.lastError ??
              "Sign in with Google again to keep your numbers up to date."
            }
          >
            <div className="mt-5 flex justify-center">
              <ConnectGoogleButton label="Reconnect Google" />
            </div>
          </LockCard>
        ) : state === "choose" && view ? (
          <div className="w-full max-w-2xl rounded-[1.75rem] border border-border/70 bg-card/85 p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="text-center">
              <h2 className="text-[17px] font-semibold tracking-tight">Pick what to measure</h2>
              <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] text-muted-foreground">
                {isAdmin
                  ? "Choose your website, your search site, or both."
                  : "A workspace admin needs to choose a website or a search site."}
              </p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SourcePicker kind="ga4_property" view={view} canChoose={isAdmin} />
              <SourcePicker kind="gsc_site" view={view} canChoose={isAdmin} />
            </div>
          </div>
        ) : (
          <LockCard
            title="Connect your data"
            body="Mellox reads Google Analytics and Search Console to show your numbers here."
          >
            <SourceList />
            <div className="mt-5 flex justify-center">
              <ConnectGoogleButton />
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden />
              Read-only. Mellox never changes anything in Google.
            </p>
            <button
              type="button"
              onClick={() => emitAppEvent("open:ai-visibility")}
              className="mt-3 text-[11.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              No Google account? Run an AI Visibility scan instead
            </button>
          </LockCard>
        )}
      </div>
    </div>
  );
}

/* ── Gate ──────────────────────────────────────────────────────────────── */

/** Renders the analytics surface only once a Google source exists. */
export function AnalyticsGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useGoogleConnection();
  const state: AccessState =
    isLoading && !data ? "loading" : isError && !data ? "failed" : accessStateOf(data);

  if (state === "loading") {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border bg-muted/25"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-muted/20" />
      </div>
    );
  }
  if (state !== "open") return <LockedScreen state={state} view={data} />;
  return <>{children}</>;
}
