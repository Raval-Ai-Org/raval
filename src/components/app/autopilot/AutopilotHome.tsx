"use client";

// Autopilot's home page: what needs a person, the week day by day, the last
// seven days in numbers, and every job Autopilot runs with where it stands.
// Drawn from the view object only, like the rest of the surface.
import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  ListChecks,
  Pause,
  Pencil,
  Play,
  TrendingUp,
  X,
} from "@/components/icons";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import type { ActionView, AutopilotView } from "@/lib/autopilot/contracts";
import { STATUS_LABEL, statusTone } from "@/lib/autopilot/state";
import { pauseReasonText } from "@/lib/autopilot/status";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { StrategyCard } from "./AutopilotSetup";
import type { AutopilotHandlers, Section } from "./AutopilotScreen";
import { Dot, pieceLabel, whenLabel } from "./autopilot-ui";
import { jobsFor, type Go } from "./jobs";
import { Pipeline, Timeline, TONE_DOT, weekDays } from "./visuals";

function More({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

/* ───────────────────────── needs you ───────────────────────── */

type Ask = {
  id: string;
  tone: "warn" | "bad";
  icon: ComponentType<{ className?: string }>;
  title: string;
  detail?: string;
  cta: string;
  primary?: boolean;
  go: Go;
};

function asks(view: AutopilotView): Ask[] {
  const out: Ask[] = [];
  const waiting = view.approvals.length;
  if (waiting) {
    out.push({
      id: "approvals",
      tone: "warn",
      icon: ListChecks,
      title: `${waiting} ${waiting === 1 ? "post needs" : "posts need"} your OK`,
      detail: view.approvals[0]?.plannedFor
        ? `First one is due ${whenLabel(view.approvals[0].plannedFor)}`
        : undefined,
      cta: "Review",
      primary: true,
      go: { section: "approvals" },
    });
  }
  for (const item of view.readiness.filter((r) => !r.ok)) {
    out.push({
      id: item.id,
      tone: "warn",
      icon: AlertTriangle,
      title: item.label,
      detail: item.detail,
      cta: item.cta,
      primary: item.required && !waiting,
      go: { open: item.id },
    });
  }
  if (view.failed.length) {
    out.push({
      id: "failed",
      tone: "bad",
      icon: AlertTriangle,
      title: `${view.failed.length} ${view.failed.length === 1 ? "step" : "steps"} didn't work`,
      cta: "See why",
      go: { section: "activity" },
    });
  }
  return out;
}

function NeedsYou({ items, go }: { items: Ask[]; go: (target: Go) => void }) {
  return (
    <Tile className="overflow-hidden p-0 sm:p-0">
      <ul className="divide-y divide-border/50">
        {items.map((ask) => {
          const Icon = ask.icon;
          return (
            <li key={ask.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  ask.tone === "bad" ? "text-destructive" : "text-warning",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{ask.title}</p>
                {ask.detail && (
                  <p className="truncate text-[12.5px] text-muted-foreground">{ask.detail}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => go(ask.go)}
                className={cn(
                  ask.primary ? dsPrimaryBtn : dsGhostBtn,
                  "h-9 shrink-0 px-4 text-[13px]",
                )}
              >
                {ask.cta}
              </button>
            </li>
          );
        })}
      </ul>
    </Tile>
  );
}

/* ───────────────────────── the week ───────────────────────── */

function timeOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function AgendaPiece({ action, onOpen }: { action: ActionView; onOpen: () => void }) {
  const Icon = action.platform ? PLATFORMS[action.platform as PlatformId]?.icon : undefined;
  const waits = action.status === "needs_approval" || action.status === "proposed";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={`${pieceLabel(action)} · ${STATUS_LABEL[action.status]}`}
        className="group flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span
          className={cn(
            "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
            TONE_DOT[statusTone(action.status)],
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium leading-snug">{action.title}</span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {Icon ? (
              <Icon className="mr-1.5 inline-block h-3 w-3 align-[-1px]" />
            ) : (
              <Pencil className="mr-1.5 inline-block h-3 w-3 align-[-1px]" />
            )}
            <span className="tabular-nums">{timeOf(action.plannedFor)}</span>
            {` · ${pieceLabel(action)}`}
            {waits && (
              <span className="font-semibold text-warning @md:hidden"> · Needs your OK</span>
            )}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 hidden shrink-0 text-[12px] @md:inline",
            waits ? "font-semibold text-warning" : "text-muted-foreground",
          )}
        >
          {waits ? "Needs your OK" : STATUS_LABEL[action.status]}
        </span>
      </button>
    </li>
  );
}

/** The next seven days, one row a day, with the real pieces on each. */
function Agenda({ view, go }: { view: AutopilotView; go: (target: Go) => void }) {
  const days = weekDays(view);
  return (
    <Tile className="@container p-2 sm:p-2.5">
      <ol aria-label="Next 7 days">
        {days.map(({ day, actions }, i) => {
          const sorted = [...actions].sort((a, b) =>
            (a.plannedFor ?? "").localeCompare(b.plannedFor ?? ""),
          );
          return (
            <li
              key={day.toISOString()}
              className={cn(
                "flex gap-2 px-1.5 sm:gap-3 sm:px-2.5",
                sorted.length ? "py-2" : "py-1",
                i > 0 && "border-t border-border/40",
              )}
            >
              <div className="flex w-[58px] shrink-0 items-center gap-2 self-start py-1.5">
                <span
                  className={cn(
                    "grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12.5px] font-semibold tabular-nums",
                    i === 0 ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {i === 0 ? "Today" : day.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
              </div>
              {sorted.length ? (
                <ul className="min-w-0 flex-1">
                  {sorted.map((a) => (
                    <AgendaPiece
                      key={a.id}
                      action={a}
                      onOpen={() =>
                        go(
                          a.status === "needs_approval" || a.status === "proposed"
                            ? { section: "approvals" }
                            : { open: "calendar" },
                        )
                      }
                    />
                  ))}
                </ul>
              ) : (
                <span className="self-center py-1.5 text-[12.5px] text-muted-foreground/60">
                  Nothing planned
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Tile>
  );
}

/* ───────────────────────── numbers ───────────────────────── */

function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="min-w-0 py-3.5">
      <p
        className="text-[22px] font-semibold leading-none tracking-tight tabular-nums"
        style={{ whiteSpace: "nowrap" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[12px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

function compact(n: number): string {
  return n >= 10_000
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n)
    : n.toLocaleString();
}

function Numbers({ view }: { view: AutopilotView }) {
  const budget = view.budget;
  const used = budget?.creditCap ? Math.min(1, budget.creditsUsed / budget.creditCap) : 0;
  return (
    <Tile className="px-4 py-1 sm:px-5 sm:py-1.5">
      <div className="grid grid-cols-3 gap-3">
        <Figure value={view.week.posted} label="Posted" />
        <Figure value={view.week.views ? compact(view.week.views) : "–"} label="Views so far" />
        <Figure value={view.approvals.length + view.upcoming.length} label="Coming up" />
      </div>
      {budget && budget.creditCap > 0 && (
        <div className="border-t border-border/50 py-3">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="text-muted-foreground">Credits this week</span>
            <span className="font-medium tabular-nums">
              {budget.creditsUsed} of {budget.creditCap}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]"
            role="img"
            aria-label={`${budget.creditsUsed} of ${budget.creditCap} credits used this week`}
          >
            <motion.div
              className={cn("h-full rounded-full", used >= 1 ? "bg-warning" : "bg-primary")}
              initial={{ width: 0 }}
              animate={{ width: `${used * 100}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}
    </Tile>
  );
}

/* ───────────────────────── what it runs ───────────────────────── */

function JobBoard({ view, go }: { view: AutopilotView; go: (target: Go) => void }) {
  const jobs = jobsFor(view);
  const running = jobs.filter((j) => j.on).length;
  return (
    <>
      <GroupLabel
        action={
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {running} of {jobs.length} on
          </span>
        }
      >
        What Autopilot runs
      </GroupLabel>
      <Tile className="overflow-hidden p-0 sm:p-0">
        <ul className="divide-y divide-border/50" aria-label="What Autopilot runs">
          {jobs.map((job) => {
            const Icon = job.icon;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => go(job.go)}
                  className="group flex min-h-[54px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                >
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      job.on ? "text-foreground/80" : "text-muted-foreground/50",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13.5px] font-medium",
                        !job.on && "text-muted-foreground",
                      )}
                    >
                      {job.label}
                    </span>
                    <span
                      className={cn(
                        "block truncate text-[12px]",
                        job.attention ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {job.state}
                    </span>
                  </span>
                  {job.figure ? (
                    <span className="shrink-0 text-[17px] font-semibold tabular-nums">
                      {job.figure}
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        job.attention
                          ? "bg-warning"
                          : job.on
                            ? "bg-primary"
                            : "border border-border bg-transparent",
                      )}
                    />
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ul>
      </Tile>
    </>
  );
}

/* ───────────────────────── the plan (Assist) ───────────────────────── */

export function ProposedPlan({
  view,
  handlers,
}: {
  view: AutopilotView;
  handlers: AutopilotHandlers;
}) {
  return (
    <Tile>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-semibold">Your plan is ready</p>
        {view.canEdit && (
          <button
            type="button"
            disabled={handlers.busy}
            onClick={handlers.approvePlan}
            className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]")}
          >
            <Check className="h-4 w-4" />
            Approve plan
          </button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-border/50">
        {view.proposed.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{a.title}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {pieceLabel(a)} · {whenLabel(a.plannedFor)}
              </p>
            </div>
            {view.canEdit && (
              <button
                type="button"
                aria-label={`Remove ${a.title}`}
                disabled={handlers.busy}
                onClick={() => handlers.decide(a.id, "skip")}
                className={dsIconBtn}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/* ───────────────────────── home ───────────────────────── */

export function Home({
  view,
  handlers,
  onSection,
}: {
  view: AutopilotView;
  handlers: AutopilotHandlers;
  onSection: (s: Section) => void;
}) {
  const program = view.program!;
  const paused = program.status === "paused";
  const next = view.upcoming.find((a) => a.plannedFor && Date.parse(a.plannedFor) > Date.now());
  const planning =
    !paused && !view.upcoming.length && !view.proposed.length && !view.approvals.length;
  const go = (target: Go) =>
    "section" in target ? onSection(target.section) : handlers.open(target.open);
  const needs = asks(view);

  return (
    <SurfacePage width="wide">
      <div className="ds-enter @container">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-1">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 text-[24px] font-semibold leading-tight tracking-tight">
              <Dot tone={paused ? "attention" : "active"} pulse={!paused} />
              {paused ? "Autopilot is paused" : "Autopilot is on"}
            </p>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              {paused
                ? `${pauseReasonText(program.pauseReason)}.`
                : next
                  ? `Next: ${whenLabel(next.plannedFor)} · ${pieceLabel(next)}`
                  : planning
                    ? "Writing your first plan…"
                    : "Nothing scheduled right now."}
              <span className="text-muted-foreground/70">
                {" "}
                · Week {program.week} of {program.totalWeeks}
              </span>
            </p>
          </div>
          {view.canEdit && (
            <button
              type="button"
              disabled={handlers.busy}
              onClick={() => handlers.pause(!paused)}
              className={cn(paused ? dsPrimaryBtn : dsGhostBtn, "h-10 px-5 text-[13.5px]")}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? "Resume" : "Pause"}
            </button>
          )}
        </header>

        {/* Anything that waits for a person comes first, with the button that moves it. */}
        {needs.length > 0 && (
          <div className="mt-4">
            <NeedsYou items={needs} go={go} />
          </div>
        )}
        {view.proposed.length > 0 && (
          <div className="mt-3">
            <ProposedPlan view={view} handlers={handlers} />
          </div>
        )}

        <div className="mt-6 grid gap-x-6 @3xl:grid-cols-[minmax(0,1fr)_288px]">
          <div className="min-w-0">
            <GroupLabel>Where your posts are</GroupLabel>
            <Pipeline view={view} onApprove={() => onSection("approvals")} />

            <GroupLabel
              action={<More onClick={() => handlers.open("calendar")}>Open calendar</More>}
            >
              Next 7 days
            </GroupLabel>
            <Agenda view={view} go={go} />

            {view.learnings.length > 0 && (
              <>
                <GroupLabel>What Mellox learned</GroupLabel>
                <Tile>
                  <ul className="space-y-2.5">
                    {view.learnings.map((line) => (
                      <li
                        key={line}
                        className="flex items-start gap-2.5 text-[13.5px] leading-snug"
                      >
                        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    Used in next week&apos;s plan.
                  </p>
                </Tile>
              </>
            )}
          </div>

          <div className="min-w-0">
            <GroupLabel>Last 7 days</GroupLabel>
            <Numbers view={view} />
            <JobBoard view={view} go={go} />
          </div>
        </div>

        {view.events.length > 0 && (
          <>
            <GroupLabel action={<More onClick={() => onSection("activity")}>See all</More>}>
              Latest
            </GroupLabel>
            <Tile>
              <Timeline events={view.events.slice(0, 4)} />
            </Tile>
          </>
        )}

        {program.strategy && (
          <>
            <GroupLabel>Strategy</GroupLabel>
            <StrategyCard strategy={program.strategy} compact />
          </>
        )}
      </div>
    </SurfacePage>
  );
}
