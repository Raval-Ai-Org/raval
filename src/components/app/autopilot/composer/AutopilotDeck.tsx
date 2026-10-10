"use client";

// Autopilot inside the chat message box. Off, it is one small switch in the
// box's toolbar. On, it takes over the whole box: what is planned, what is
// being made, what waits for a person and what else is running, with the
// controls in reach.
//
// Everything here is drawn from one view object and a set of handlers, so the
// app (useComposerAutopilot) and the dev-only lab render the same thing.
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Bot,
  Check,
  Lightbulb,
  ListChecks,
  Plug,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Type,
  X,
} from "@/components/icons";
import { PlanLock } from "@/components/app/billing/billing-ui";
import {
  MODE_INFO,
  type AutopilotView,
  type ProgramSettings,
  type ReadinessItem,
} from "@/lib/autopilot/contracts";
import { nextSteps, stepLine } from "@/lib/autopilot/agenda";
import { pauseReasonText } from "@/lib/autopilot/status";
import { statusTone } from "@/lib/autopilot/state";
import type { PlanId } from "@/lib/billing/catalog";
import { PLATFORMS } from "@/lib/social-platforms";
import { settingsValid, weeklyEstimate, type SuggestionState } from "../AutopilotSetup";
import type { Section } from "../AutopilotScreen";
import { pieceLabel } from "../autopilot-ui";
import { jobsFor } from "../jobs";
import { STAGES, stageCounts, TONE_DOT, weekDays } from "../visuals";

export type AutopilotSignal = "off" | "on" | "paused";

const EASE = [0.22, 1, 0.36, 1] as const;
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/* ───────────────────────── small parts ───────────────────────── */

/** The mark that says "Autopilot": lime when it runs, amber when paused, grey when off. */
export function AutopilotOrb({
  state,
  size = 40,
}: {
  state: AutopilotSignal | "arming";
  size?: number;
}) {
  return (
    <span className="ap-orb" data-state={state} style={{ width: size, height: size }} aria-hidden>
      <span className="ap-orb__ring" />
      <span className="ap-orb__core">
        <Bot style={{ width: size * 0.34, height: size * 0.34 }} strokeWidth={2.2} />
      </span>
    </span>
  );
}

export function AutopilotSwitch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="ap-switch"
    >
      <span className="ap-switch__thumb" />
    </button>
  );
}

/** The control in the message box's toolbar. */
export function AutopilotToggle({
  state,
  waiting = 0,
  lockedPlan,
  onClick,
}: {
  state: AutopilotSignal;
  waiting?: number;
  lockedPlan?: PlanId | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={state === "on"}
      aria-label={
        state === "on"
          ? "Autopilot is on. Show it."
          : state === "paused"
            ? "Autopilot is paused. Turn it back on."
            : "Turn on Autopilot"
      }
      title={
        state === "on" ? "Autopilot is on" : state === "paused" ? "Autopilot is paused" : undefined
      }
      onClick={onClick}
      className="ap-toggle"
      data-tour="autopilot"
      data-state={state}
    >
      <span className="ap-toggle__track" aria-hidden>
        <span className="ap-toggle__thumb" />
      </span>
      <span>Autopilot</span>
      {lockedPlan ? (
        <PlanLock plan={lockedPlan} className="ml-0.5" />
      ) : waiting > 0 ? (
        <span className="ap-badge" data-tone="warn">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}

/** A small live sign for the top bar: Autopilot is running, wherever you are. */
export function AutopilotBeacon({
  state,
  waiting,
  onClick,
}: {
  state: "on" | "paused";
  waiting: number;
  onClick: () => void;
}) {
  const label =
    state === "paused"
      ? "Autopilot is paused"
      : waiting
        ? `Autopilot is on. ${waiting} to approve.`
        : "Autopilot is on";
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ap-beacon"
      data-state={state}
    >
      <AutopilotOrb state={state} size={22} />
      <span className="hidden sm:inline">{state === "paused" ? "Paused" : "Autopilot"}</span>
      {waiting > 0 && (
        <span className="ap-badge" data-tone="warn">
          {waiting}
        </span>
      )}
    </motion.button>
  );
}

function DeckButton({
  onClick,
  icon: Icon,
  children,
  label,
  tone,
  count,
  disabled,
}: {
  onClick: () => void;
  icon: typeof Bot;
  children?: ReactNode;
  label?: string;
  tone?: "warn" | "bad" | "primary";
  count?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="ap-btn"
      data-tone={tone}
      data-icon-only={children ? undefined : ""}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2} />
      {children}
      {count ? (
        <span className="ap-badge" data-tone={tone === "primary" ? undefined : tone}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

/* ───────────────────────── the pictures ───────────────────────── */

/** Plan → write → approve → schedule → post: a count and a bar per stage. */
function Flow({ view }: { view: AutopilotView }) {
  const counts = stageCounts(view);
  return (
    <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Where your posts are">
      {STAGES.map((stage, i) => {
        const count = counts[i];
        const warn = stage.id === "approve" && count > 0;
        return (
          <li key={stage.id} className="min-w-0" aria-label={`${stage.label}: ${count}`}>
            <span
              className={cn(
                "block h-[3px] rounded-full",
                warn ? "bg-warning" : count ? "bg-primary" : "bg-foreground/10",
              )}
            />
            <span className="mt-1.5 flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
              <span
                className={cn(
                  "text-[15px] font-semibold leading-none tabular-nums",
                  !count && "text-muted-foreground/50",
                )}
              >
                {count}
              </span>
              <span
                className={cn(
                  "truncate text-[11px]",
                  warn ? "font-semibold text-warning" : "text-muted-foreground",
                )}
              >
                {stage.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What else is running beyond the posts, in one quiet line. */
function AlsoRunning({ view }: { view: AutopilotView }) {
  const jobs = jobsFor(view).filter((j) => j.on && j.id !== "posts");
  if (!jobs.length) return null;
  return (
    <p className="truncate text-[12px] text-muted-foreground" data-testid="deck-also">
      <span className="text-foreground/70">Also running:</span>{" "}
      {jobs.map((j) => (j.figure ? `${j.short} ${j.figure}` : j.short)).join(" · ")}
    </p>
  );
}

/** The next seven days, one dot per piece. */
function Week({ view }: { view: AutopilotView }) {
  const days = weekDays(view);
  return (
    <ol className="ap-week" aria-label="Next 7 days">
      {days.map(({ day, actions }, i) => (
        <li
          key={day.toISOString()}
          className="ap-week__day"
          data-today={i === 0 ? "" : undefined}
          title={actions.map((a) => a.title).join(" · ") || undefined}
          aria-label={`${day.toLocaleDateString(undefined, { weekday: "long" })}: ${actions.length} planned`}
        >
          <span className="ap-week__letter">{DAY_LETTERS[day.getDay()]}</span>
          <span className="ap-week__cell">
            {actions.slice(0, 3).map((a, k) => (
              <motion.span
                key={a.id}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.25 + i * 0.04 + k * 0.05, type: "spring", stiffness: 420 }}
                className={cn("size-1.5 rounded-full", TONE_DOT[statusTone(a.status)])}
              />
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Budget({ view }: { view: AutopilotView }) {
  const budget = view.budget;
  if (!budget || !budget.creditCap) return null;
  const used = Math.min(1, budget.creditsUsed / budget.creditCap);
  return (
    <div
      className="ap-budget"
      role="img"
      aria-label={`${budget.creditsUsed} of ${budget.creditCap} credits used this week`}
      title="Credits used this week"
    >
      <span className="ap-budget__bar">
        <motion.span
          className="ap-budget__fill"
          initial={{ width: 0 }}
          animate={{ width: `${used * 100}%` }}
          transition={{ duration: 0.8, delay: 0.3, ease: EASE }}
        />
      </span>
      <span className="tabular-nums">
        {budget.creditsUsed}/{budget.creditCap}
      </span>
    </div>
  );
}

function Dots() {
  return (
    <span className="ap-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/* ───────────────────────── the deck ───────────────────────── */

export type DeckHandlers = {
  /** Turn it on for the first time with what Mellox proposed. */
  start: (settings: ProgramSettings) => void;
  pause: (paused: boolean) => void;
  /** Give the box back to the keyboard. */
  write: () => void;
  /** Open the full Autopilot screen, at a section. */
  open: (section: Section) => void;
  /** Go where something missing is connected or added. */
  fix: (target: ReadinessItem["id"]) => void;
  retry: () => void;
  busy: boolean;
};

export function AutopilotDeck({
  view,
  failed,
  suggestion,
  handlers,
}: {
  /** Undefined while it loads. */
  view: AutopilotView | undefined;
  failed?: boolean;
  suggestion: SuggestionState;
  handlers: DeckHandlers;
}) {
  if (!view) {
    return (
      <div className="ap-deck" data-state="setup" aria-busy={!failed}>
        <div className="flex items-center gap-3">
          <AutopilotOrb state={failed ? "off" : "arming"} />
          <p className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight">
            {failed ? "Autopilot didn't load" : "Autopilot"}
            {!failed && <Dots />}
          </p>
          {failed && (
            <DeckButton icon={RotateCcw} onClick={handlers.retry}>
              Try again
            </DeckButton>
          )}
          <DeckButton icon={Type} onClick={handlers.write} label="Write a message" />
        </div>
        {!failed && <div className="ap-skeleton h-[4.25rem]" aria-hidden />}
      </div>
    );
  }
  return view.program ? (
    <LiveDeck view={view} handlers={handlers} />
  ) : (
    <SetupDeck view={view} suggestion={suggestion} handlers={handlers} />
  );
}

function LiveDeck({ view, handlers }: { view: AutopilotView; handlers: DeckHandlers }) {
  const program = view.program!;
  const paused = program.status !== "running";
  const next = nextSteps(view, { limit: 1 })[0];
  const waiting = view.approvals.length + (view.proposed.length ? 1 : 0);
  const planning = !paused && !view.upcoming.length && !view.proposed.length && !waiting;
  const missing = view.readiness.find((r) => !r.ok && r.required);
  const NextIcon = next?.action?.platform
    ? PLATFORMS[next.action.platform as keyof typeof PLATFORMS]?.icon
    : undefined;

  return (
    <div className="ap-deck" data-state={paused ? "paused" : "on"}>
      <div className="flex items-center gap-3">
        <AutopilotOrb state={paused ? "paused" : "on"} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight tracking-tight">
            {paused ? "Autopilot is paused" : "Autopilot is on"}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
            {paused ? (
              <span className="truncate">{pauseReasonText(program.pauseReason)}</span>
            ) : next ? (
              <>
                {NextIcon && <NextIcon className="size-3.5 shrink-0" />}
                <span
                  className="truncate"
                  title={next.action ? pieceLabel(next.action) : undefined}
                >
                  Next · {stepLine(next)}
                </span>
              </>
            ) : planning ? (
              <>
                Writing your plan
                <Dots />
              </>
            ) : (
              <span className="truncate">Nothing scheduled right now</span>
            )}
          </p>
        </div>
        {view.canEdit && (
          <AutopilotSwitch
            on={!paused}
            disabled={handlers.busy}
            onChange={(on) => handlers.pause(!on)}
            label={paused ? "Turn Autopilot back on" : "Pause Autopilot"}
          />
        )}
      </div>

      <Flow view={view} />

      <div className="flex items-end gap-4">
        <Week view={view} />
        <Budget view={view} />
      </div>

      <AlsoRunning view={view} />

      <div className="ap-deck__bar">
        <DeckButton icon={Type} onClick={handlers.write}>
          Write
        </DeckButton>
        <span className="flex-1" />
        {missing && (
          <DeckButton icon={Plug} tone="warn" onClick={() => handlers.fix(missing.id)}>
            <span className="max-w-[11rem] truncate">{missing.label}</span>
          </DeckButton>
        )}
        {view.failed.length > 0 && (
          <DeckButton
            icon={AlertTriangle}
            tone="bad"
            count={view.failed.length}
            label={`${view.failed.length} didn't work. See why.`}
            onClick={() => handlers.open("activity")}
          />
        )}
        {waiting > 0 && (
          <DeckButton
            icon={ListChecks}
            tone="warn"
            count={waiting}
            onClick={() => handlers.open("approvals")}
          >
            Approve
          </DeckButton>
        )}
        {view.opportunities.length > 0 && (
          <DeckButton
            icon={Lightbulb}
            count={view.opportunities.length}
            label={`${view.opportunities.length} new ideas`}
            onClick={() => handlers.open("ideas")}
          />
        )}
        {view.canManage && (
          <DeckButton icon={Settings} label="Settings" onClick={() => handlers.open("settings")} />
        )}
        <DeckButton icon={SlidersHorizontal} tone="primary" onClick={() => handlers.open("home")}>
          Open
        </DeckButton>
      </div>
    </div>
  );
}

function SetupDeck({
  view,
  suggestion,
  handlers,
}: {
  view: AutopilotView;
  suggestion: SuggestionState;
  handlers: DeckHandlers;
}) {
  const s = suggestion.data?.settings;
  const blocked =
    !s ||
    !settingsValid(s) ||
    (s.mode === "full" && view.readiness.some((r) => r.required && !r.ok));
  const missing = view.readiness.filter((r) => !r.ok);

  return (
    <div className="ap-deck" data-state="setup">
      <div className="flex items-center gap-3">
        <AutopilotOrb state={s ? "off" : "arming"} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight tracking-tight">Autopilot</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {!view.canManage
              ? "An admin of this workspace can turn it on."
              : suggestion.failed
                ? "We couldn't read your brand just now."
                : s
                  ? "Plans, writes and posts for you. Set up once."
                  : "Reading your brand"}
            {view.canManage && !suggestion.failed && !s && <Dots />}
          </p>
        </div>
        <DeckButton icon={X} onClick={handlers.write} label="Close" />
      </div>

      {view.canManage && !s && !suggestion.failed && (
        <div className="ap-skeleton h-[4.25rem]" aria-hidden />
      )}

      {view.canManage && s && (
        <>
          {s.strategy?.summary && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="line-clamp-2 text-[13.5px] leading-snug text-foreground/85"
            >
              {s.strategy.summary}
            </motion.p>
          )}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.06, ease: EASE }}
            className="flex flex-wrap items-center gap-2"
          >
            <span
              className="ap-fact"
              aria-label={s.platforms.map((p) => PLATFORMS[p].label).join(", ")}
            >
              {s.platforms.map((p) => {
                const Icon = PLATFORMS[p].icon;
                return <Icon key={p} className="size-3.5" />;
              })}
            </span>
            <span className="ap-fact" aria-label={`${s.postsPerWeek} posts a week`}>
              <span className="flex items-center gap-[3px]" aria-hidden>
                {DAY_LETTERS.map((_, d) => (
                  <span
                    key={d}
                    className={cn(
                      "size-1.5 rounded-full",
                      s.weekdays.includes(d) ? "bg-primary" : "bg-foreground/15",
                    )}
                  />
                ))}
              </span>
              {s.postsPerWeek} a week
            </span>
            <span className="ap-fact">
              <Check className="size-3.5" strokeWidth={2.4} />
              {MODE_INFO[s.mode].label}
            </span>
            <span className="ap-fact tabular-nums">~{weeklyEstimate(s)} credits a week</span>
          </motion.div>
        </>
      )}

      <div className="ap-deck__bar">
        {view.canManage && (
          <>
            <button
              type="button"
              disabled={handlers.busy || blocked}
              onClick={() => s && handlers.start(s)}
              className="ap-start"
            >
              {handlers.busy ? "Turning on" : "Turn on"}
              {handlers.busy && <Dots />}
            </button>
            <DeckButton icon={SlidersHorizontal} onClick={() => handlers.open("home")}>
              Adjust
            </DeckButton>
          </>
        )}
        <span className="flex-1" />
        {missing.slice(0, 2).map((r) => (
          <DeckButton key={r.id} icon={Plug} tone="warn" onClick={() => handlers.fix(r.id)}>
            <span className="max-w-[11rem] truncate">{r.label}</span>
          </DeckButton>
        ))}
      </div>
    </div>
  );
}
