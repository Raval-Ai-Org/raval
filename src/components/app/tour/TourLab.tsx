"use client";

// Development-only visual check for the app tour: a stand-in for the app
// shell (sidebar, top bar, message box) with the same `data-tour` names, and
// the real tour on top. Nothing here talks to a server.
import { useEffect, useMemo, useState } from "react";
import { tourStops, type TourStop } from "@/lib/tour/steps";
import { cn } from "@/lib/utils";
import { AppTour } from "./AppTour";

const SIDEBAR: { tour: string; label: string }[] = [
  { tour: "library", label: "Library" },
  { tour: "brain", label: "Brain" },
  { tour: "analytics", label: "Analytics" },
  { tour: "calendar", label: "Content calendar" },
  { tour: "visibility", label: "AI Visibility" },
];

export function TourLab() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(true);
  const [initialStep, setInitialStep] = useState(-1);
  const [autopilot, setAutopilot] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [last, setLast] = useState("");
  const [run, setRun] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const step = Number(params.get("step"));
    if (params.has("step") && Number.isFinite(step)) setInitialStep(step);
    if (params.get("autopilot") === "off") setAutopilot(false);
    setReady(true);
  }, []);

  const stops = useMemo(() => tourStops({ autopilot }), [autopilot]);
  const onStop = (stop: TourStop | null) => setDrawer(Boolean(stop?.sidebar));

  return (
    <div
      data-mellox-app
      data-testid="tour-lab-frame"
      data-ready={ready}
      className="flex h-dvh w-full overflow-hidden bg-sidebar text-foreground"
    >
      <aside
        className={cn(
          "h-full w-[240px] flex-none flex-col gap-1 overflow-y-auto border-r border-border/60 bg-sidebar p-2",
          "lg:flex",
          drawer
            ? "fixed inset-y-0 left-0 z-40 flex shadow-2xl lg:static lg:shadow-none"
            : "hidden",
        )}
      >
        <div className="px-2 py-3 text-[13px] font-semibold">Mellox AI</div>
        {SIDEBAR.map((item) => (
          <button
            key={item.tour}
            type="button"
            data-tour={item.tour}
            onClick={() => setLast(`clicked:${item.tour}`)}
            className="flex w-full items-center gap-3 rounded-full px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground/75"
          >
            <span className="h-7 w-7 rounded-full bg-[var(--ds-well-bg)]" />
            {item.label}
          </button>
        ))}
        <div
          data-tour="account"
          className="mt-auto border-t border-border/50 px-2 py-3 text-[13px]"
        >
          Sam Rivera
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
          <span className="text-[12.5px] font-medium">Tour lab</span>
          <span data-testid="lab-last" className="truncate text-[12px] text-muted-foreground">
            {last}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setInitialStep(-1);
                setRun((n) => n + 1);
                setOpen(true);
              }}
              className="h-8 rounded-full bg-secondary px-3 text-[12px] font-medium"
            >
              Replay
            </button>
            <button
              type="button"
              data-tour="studio"
              className="h-8 rounded-md border border-primary/40 px-2.5 text-[12px] font-semibold"
            >
              Studio
            </button>
            <button
              type="button"
              data-tour="share"
              className="h-8 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground"
            >
              Share
            </button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4">
          <p className="text-[22px] font-semibold tracking-tight">What are we making today?</p>
          <div
            data-tour="chat"
            className="w-full max-w-[640px] rounded-[26px] border border-border/70 bg-card p-3"
          >
            <div className="h-12 px-2 text-[14px] text-muted-foreground">Ask Mellox anything</div>
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 rounded-full bg-[var(--ds-well-bg)]" />
              {autopilot && (
                <button
                  type="button"
                  data-tour="autopilot"
                  className="h-8 rounded-full bg-[var(--ds-well-bg)] px-3 text-[12.5px] font-medium"
                >
                  Autopilot
                </button>
              )}
            </div>
          </div>
        </main>
      </div>

      {ready && open && (
        <AppTour
          key={run}
          stops={stops}
          name="Sam"
          initialStep={initialStep}
          onStop={onStop}
          onClose={(action) => {
            setOpen(false);
            setDrawer(false);
            setLast(action ? `closed:${action}` : "closed");
          }}
        />
      )}
    </div>
  );
}
