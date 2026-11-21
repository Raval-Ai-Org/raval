"use client";

// Home's Autopilot area (Mellox 2.0, Holo style). One wide card under the
// bento: off, it invites a person into the step-by-step setup; on, it shows
// at a glance what Autopilot is doing (the flow, the next pieces, what waits)
// and the places it works with. Pressing the card opens the full Autopilot
// screen. The message box is never touched.
//
// Presentational: HomeAutopilot wires it, /autopilot-lab?scene=card renders
// every state with sample data.
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowRight, CalendarDays, Check, Pause, Play, Target, Users } from "@/components/icons";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { nextSteps, stepLine } from "@/lib/autopilot/agenda";
import type { ActionView, AutopilotView } from "@/lib/autopilot/contracts";
import { pauseReasonText } from "@/lib/autopilot/status";
import type { PlanId } from "@/lib/billing/catalog";
import type { PulseCampaign } from "@/lib/pulse/pulse";
import type { Section } from "../AutopilotScreen";
import { AutopilotOrb } from "../composer/AutopilotDeck";
import {
  FlowRail,
  LinkedPlaces,
  UpcomingCards,
  UpcomingPlaceholder,
  type LinkedPlace,
} from "../flow";

const EASE = [0.22, 1, 0.36, 1] as const;

export type HomeAutopilotState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "locked"; plan: PlanId }
  /** Not set up yet. */
  | { kind: "off"; canManage: boolean }
  | { kind: "live"; view: AutopilotView };

export type HomeAutopilotHandlers = {
  /** Open the full screen, at a section. Off, this is the setup. */
  open: (section?: Section) => void;
  upgrade: () => void;
  pause: (paused: boolean) => void;
  place: (place: LinkedPlace) => void;
  retry: () => void;
  busy?: boolean;
};

/** The card's frame: a stretched button opens Autopilot, inner controls sit above it. */
function Shell({
  children,
  label,
  onOpen,
  state,
}: {
  children: ReactNode;
  label: string;
  onOpen: () => void;
  state: "on" | "paused" | "off";
}) {
  return (
    <section
      aria-label="Autopilot"
      data-tour="autopilot"
      data-state={state}
      className="ap-home ds-card ds-card-hover group/ap relative overflow-hidden p-4 @container sm:p-5"
    >
      <span aria-hidden className="ap-home__wash" />
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      />
      {/* Inner controls keep pointer events; empty space falls through to the button. */}
      <div className="pointer-events-none relative z-[1] [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_[role=switch]]:pointer-events-auto">
        {children}
      </div>
    </section>
  );
}

function OpenPill({ onClick, children = "Open" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-3.5 pr-2.5 text-[12.5px] font-semibold text-foreground/85 shadow-[var(--ds-card-shadow)] transition-all hover:text-foreground hover:shadow-[var(--ds-card-shadow-hover)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
      <ArrowRight className="size-3.5 transition-transform group-hover/ap:translate-x-0.5" />
    </button>
  );
}

/* ───────────────────────── not set up ───────────────────────── */

const SETUP_STEPS: { label: string; icon: typeof Target }[] = [
  { label: "Goal", icon: Target },
  { label: "Channels", icon: Users },
  { label: "Rhythm", icon: CalendarDays },
  { label: "Approve", icon: Check },
];

function Invite({
  canManage,
  lockedPlan,
  handlers,
}: {
  canManage: boolean;
  lockedPlan: PlanId | null;
  handlers: HomeAutopilotHandlers;
}) {
  const reduce = useReducedMotion();
  const start = () => (lockedPlan ? handlers.upgrade() : handlers.open());
  return (
    <Shell
      label={lockedPlan ? "Autopilot: see plans" : "Set up Autopilot"}
      onOpen={start}
      state="off"
    >
      <div className="flex flex-col gap-4 @2xl:flex-row @2xl:items-center @2xl:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <span className="mox-float shrink-0">
            <MoxFace mood="excited" visor size={58} />
          </span>
          <div className="min-w-0">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 text-[11px] font-bold text-foreground/70">
              <span className="size-1.5 rounded-full bg-foreground/30" />
              Autopilot is off
              {lockedPlan && <PlanLock plan={lockedPlan} className="ml-0.5" />}
            </span>
            <h3 className="mt-1.5 text-[19px] font-bold leading-tight tracking-[-0.015em]">
              Put your posts on <span className="ds-grad-text">Autopilot</span>
            </h3>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              {canManage
                ? "Mox plans, makes and posts every week. You say yes."
                : "An admin of this workspace can turn it on."}
            </p>
          </div>
        </div>

        {/* Four steps, one picture each: what setting it up takes. */}
        <ol aria-label="Setup steps" className="relative flex items-start gap-1.5 @2xl:w-[300px]">
          <span
            aria-hidden
            className="absolute left-[12%] right-[12%] top-[19px] h-px border-t border-dashed border-foreground/20"
          />
          {SETUP_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.li
                key={step.label}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.08, ease: EASE }}
                className="relative flex min-w-0 flex-1 flex-col items-center"
              >
                <span className="ap-step-bubble grid size-10 place-items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]">
                  <Icon className="size-[17px] text-foreground/75" strokeWidth={2.1} />
                </span>
                <span className="mt-1.5 text-[10.5px] font-semibold text-muted-foreground">
                  <span className="tabular-nums">{i + 1}.</span> {step.label}
                </span>
              </motion.li>
            );
          })}
        </ol>

        {canManage && (
          <button
            type="button"
            onClick={start}
            className="studio-cta inline-flex h-11 shrink-0 items-center justify-center gap-2 self-stretch rounded-full px-5 text-[13.5px] font-bold @2xl:self-auto"
          >
            {lockedPlan ? "See plans" : "Set it up"}
            <ArrowRight className="size-4" />
          </button>
        )}
      </div>
    </Shell>
  );
}

/* ───────────────────────── running / paused ───────────────────────── */

function Live({
  view,
  campaigns,
  handlers,
}: {
  view: AutopilotView;
  campaigns: PulseCampaign[];
  handlers: HomeAutopilotHandlers;
}) {
  const program = view.program!;
  const paused = program.status !== "running";
  const next = nextSteps(view, { limit: 1 })[0];
  const waiting = view.approvals.length + (view.proposed.length ? 1 : 0);
  const planning =
    !paused && !view.upcoming.length && !view.proposed.length && !view.approvals.length;
  const following = campaigns[0]?.name;
  const openPiece = (a: ActionView) =>
    a.status === "needs_approval" || a.status === "proposed"
      ? handlers.open("approvals")
      : handlers.place("calendar");

  return (
    <Shell label="Open Autopilot" onOpen={() => handlers.open()} state={paused ? "paused" : "on"}>
      {/* Head: the orb, what it is doing, the switch and the way in. */}
      <div className="flex items-center gap-3">
        <AutopilotOrb state={paused ? "paused" : "on"} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[18px] font-bold leading-tight tracking-[-0.015em]">
              {paused ? "Autopilot is paused" : "Autopilot is on"}
            </h3>
            <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] font-bold tabular-nums text-foreground/65">
              Week {program.week} of {program.totalWeeks}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {paused
              ? pauseReasonText(program.pauseReason)
              : planning
                ? "Mox is writing this week's plan…"
                : next
                  ? `Next · ${stepLine(next)}`
                  : "All caught up"}
            {following && !paused ? ` · Plans around ${following}` : ""}
          </p>
        </div>
        {view.canEdit && (
          <button
            type="button"
            disabled={handlers.busy}
            onClick={() => handlers.pause(!paused)}
            aria-label={paused ? "Resume Autopilot" : "Pause Autopilot"}
            title={paused ? "Resume" : "Pause"}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full transition-all active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              paused
                ? "studio-cta"
                : "border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-foreground/75 shadow-[var(--ds-card-shadow)] hover:text-foreground",
            )}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </button>
        )}
        <span className="hidden @md:inline-flex">
          <OpenPill onClick={() => handlers.open()} />
        </span>
      </div>

      <div className="mt-4 grid gap-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @3xl:items-center">
        <FlowRail view={view} size="sm" onApprove={() => handlers.open("approvals")} />
        {planning ? (
          <UpcomingPlaceholder />
        ) : (
          <UpcomingCards view={view} limit={3} onOpen={openPiece} className="@3xl:grid-cols-3" />
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2.5 @2xl:flex-row @2xl:items-center">
        <LinkedPlaces
          view={view}
          campaigns={campaigns}
          onOpen={handlers.place}
          dense
          className="flex-1"
        />
        {waiting > 0 && (
          <button
            type="button"
            onClick={() => handlers.open("approvals")}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--mox-yellow)] px-3.5 text-[12.5px] font-bold text-[var(--mox-ink)] transition-transform hover:-translate-y-0.5 active:scale-[0.97]"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--mox-ink)]" />
            {waiting} to approve
          </button>
        )}
      </div>
    </Shell>
  );
}

/* ───────────────────────── the card ───────────────────────── */

export function AutopilotHomeCard({
  state,
  campaigns = [],
  handlers,
}: {
  state: HomeAutopilotState;
  /** Running campaigns, from the free workspace pulse. */
  campaigns?: PulseCampaign[];
  handlers: HomeAutopilotHandlers;
}) {
  if (state.kind === "loading") {
    return (
      <div className="ds-card relative overflow-hidden p-5" aria-busy="true" aria-label="Autopilot">
        <div className="flex items-center gap-3">
          <AutopilotOrb state="arming" size={44} />
          <div className="flex-1 space-y-2">
            <span className="ap-shimmer-tile block h-3.5 w-40 rounded-full bg-[var(--ds-well-bg)]" />
            <span className="ap-shimmer-tile block h-2.5 w-64 max-w-full rounded-full bg-[var(--ds-well-bg)]" />
          </div>
        </div>
        <div className="mt-4 @container">
          <UpcomingPlaceholder />
        </div>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="ds-card flex items-center gap-3 p-5" aria-label="Autopilot">
        <AutopilotOrb state="off" size={44} />
        <p className="min-w-0 flex-1 text-[13.5px] font-semibold">Autopilot didn&apos;t load</p>
        <OpenPill onClick={handlers.retry}>Try again</OpenPill>
      </div>
    );
  }
  if (state.kind === "locked") {
    return <Invite canManage lockedPlan={state.plan} handlers={handlers} />;
  }
  if (state.kind === "off") {
    return <Invite canManage={state.canManage} lockedPlan={null} handlers={handlers} />;
  }
  if (!state.view.program) {
    return <Invite canManage={state.view.canManage} lockedPlan={null} handlers={handlers} />;
  }
  return <Live view={state.view} campaigns={campaigns} handlers={handlers} />;
}
