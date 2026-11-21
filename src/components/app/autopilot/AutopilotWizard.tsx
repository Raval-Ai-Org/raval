"use client";

// Setting Autopilot up, one step at a time (Holo style, like Studio's steps):
// Goal → Channels → Rhythm → Approval → Ready. Mellox proposes every answer
// from Brand DNA, so a person can press Next five times and be done; each
// step is big pictures and one question. "Fine-tune" on the last step opens
// the same setting rows the Settings page uses.
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Image as ImageIcon,
  ListChecks,
  Megaphone,
  MessageCircle,
  Palette,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Target,
} from "@/components/icons";
import { MoxFace, type MoxMood } from "@/components/brand/mox/MoxFace";
import { Skeleton } from "@/components/ui/skeleton";
import { BackPill, GradProgress, StepPills } from "@/components/app/surface/MoxParts";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import { PlatformLogoGrid } from "@/components/studio/studio-ui";
import {
  AUTOPILOT_GOALS,
  AUTOPILOT_TYPES,
  MODE_INFO,
  type AutopilotGoal,
  type AutopilotMode,
  type AutopilotType,
  type ProgramSettings,
  type ReadinessItem,
} from "@/lib/autopilot/contracts";
import { PLAN_GOALS } from "@/lib/calendar/planner";
import { PLATFORM_ORDER, PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { SettingRows, settingsValid, weeklyEstimate, type SuggestionState } from "./AutopilotSetup";
import { SwitchRow } from "./autopilot-ui";
import { Readiness } from "./Readiness";

const EASE = [0.22, 1, 0.36, 1] as const;

const STEPS = [
  { id: "goal", label: "Goal" },
  { id: "channels", label: "Channels" },
  { id: "rhythm", label: "Rhythm" },
  { id: "approval", label: "Approval" },
  { id: "ready", label: "Ready" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

const SAY: Record<StepId, { mood: MoxMood; line: string; bold: string }> = {
  goal: { mood: "happy", line: "What should I", bold: "work towards?" },
  channels: { mood: "excited", line: "Where should I", bold: "post?" },
  rhythm: { mood: "thinking", line: "How often, and", bold: "what kind of posts?" },
  approval: { mood: "happy", line: "Who says", bold: "yes before it goes out?" },
  ready: { mood: "excited", line: "All set.", bold: "Here's the plan." },
};

const GOAL_LOOK: Record<
  AutopilotGoal,
  { icon: ComponentType<{ className?: string }>; line: string; tint: string }
> = {
  awareness: { icon: Megaphone, line: "Get seen by new people", tint: "hsl(195 95% 55% / 0.16)" },
  leads: { icon: Target, line: "Enquiries and sign-ups", tint: "hsl(150 90% 50% / 0.16)" },
  sales: { icon: ShoppingBag, line: "Turn followers into buyers", tint: "hsl(75 95% 55% / 0.2)" },
  engagement: { icon: MessageCircle, line: "Keep people talking", tint: "hsl(285 85% 65% / 0.16)" },
  trust: { icon: ShieldCheck, line: "Show you're the real deal", tint: "hsl(220 90% 62% / 0.16)" },
  launch: { icon: Rocket, line: "Make noise about something new", tint: "hsl(28 95% 60% / 0.18)" },
};

const PACES = [
  { id: "three", label: "3 a week", line: "Steady", postsPerWeek: 3, weekdays: [1, 3, 5] },
  { id: "weekdays", label: "Weekdays", line: "Busy", postsPerWeek: 5, weekdays: [1, 2, 3, 4, 5] },
  {
    id: "daily",
    label: "Every day",
    line: "All in",
    postsPerWeek: 7,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
] as const;

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

const TYPE_ILLO: Record<AutopilotType, IlloKind> = {
  social: "post",
  image: "poster",
  carousel: "carousel",
  video: "video",
  article: "article",
};

const MODE_LOOK: Record<AutopilotMode, ComponentType<{ className?: string }>> = {
  full: Rocket,
  autopilot: Check,
  assist: ListChecks,
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** A big selectable card: the building block of every step. */
function Choice({
  on,
  onClick,
  disabled,
  children,
  className,
  role = "radio",
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  role?: "radio" | "checkbox";
  label?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "ap-choice group/choice relative flex min-w-0 flex-col items-start rounded-[22px] border p-4 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? "border-transparent bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow-hover)]"
          : "border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)] hover:-translate-y-0.5 hover:shadow-[var(--ds-card-shadow-hover)]",
        className,
      )}
      data-on={on ? "" : undefined}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          "absolute right-3 top-3 grid size-5 place-items-center rounded-full transition-all",
          on
            ? "scale-100 bg-foreground text-background"
            : "scale-90 border border-[var(--ds-card-border)] text-transparent",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    </button>
  );
}

function StepHead({ step }: { step: StepId }) {
  const say = SAY[step];
  return (
    <div className="flex items-center gap-3">
      <span className="mox-float shrink-0">
        <MoxFace mood={say.mood} size={52} track />
      </span>
      <h3 className="text-[24px] font-bold leading-tight tracking-[-0.025em] sm:text-[28px]">
        {say.line} <span className="ds-grad-text">{say.bold}</span>
      </h3>
    </div>
  );
}

/* ───────────────────────── steps ───────────────────────── */

function GoalStep({
  s,
  set,
}: {
  s: ProgramSettings;
  set: (patch: Partial<ProgramSettings>) => void;
}) {
  const [note, setNote] = useState(Boolean(s.goalNote));
  return (
    <>
      <div role="radiogroup" aria-label="Goal" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {AUTOPILOT_GOALS.map((id) => {
          const look = GOAL_LOOK[id];
          const Icon = look.icon;
          const label = PLAN_GOALS.find((g) => g.id === id)?.label ?? id;
          return (
            <Choice key={id} on={s.goal === id} onClick={() => set({ goal: id })} label={label}>
              <span
                className="grid size-10 place-items-center rounded-2xl text-foreground/80 transition-transform group-hover/choice:scale-110"
                style={{ background: look.tint }}
              >
                <Icon className="size-5" />
              </span>
              <span className="mt-3 text-[14px] font-bold leading-tight">{label}</span>
              <span className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {look.line}
              </span>
            </Choice>
          );
        })}
      </div>
      {note ? (
        <textarea
          autoFocus
          value={s.goalNote}
          onChange={(e) => set({ goalNote: e.target.value.slice(0, 600) })}
          rows={2}
          aria-label="Anything Mox should know"
          placeholder="e.g. We open a second shop on the 20th"
          className="ds-well mt-3 w-full resize-none rounded-[18px] border-0 px-4 py-3 text-[14px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      ) : (
        <button
          type="button"
          onClick={() => setNote(true)}
          className="mt-3 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          + Anything Mox should know?
        </button>
      )}
    </>
  );
}

function ChannelsStep({
  s,
  set,
  connected,
  onOpen,
}: {
  s: ProgramSettings;
  set: (patch: Partial<ProgramSettings>) => void;
  connected: PlatformId[];
  onOpen: (target: ReadinessItem["id"]) => void;
}) {
  const unlinked = s.platforms.filter((p) => !connected.includes(p));
  return (
    <>
      <PlatformLogoGrid
        platforms={PLATFORM_ORDER}
        size={56}
        isSelected={(id) => s.platforms.includes(id)}
        onToggle={(id) => set({ platforms: toggle(s.platforms, id).slice(0, 5) })}
        note={(id) => (connected.includes(id) ? null : "not connected")}
      />
      {unlinked.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--mox-yellow)]/25 px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
            <b>{unlinked.map((p) => PLATFORMS[p].label).join(" and ")}</b> isn&apos;t connected yet.
            Its posts wait until it is.
          </p>
          <button
            type="button"
            onClick={() => onOpen("accounts")}
            className="inline-flex h-8 items-center rounded-full bg-foreground px-3.5 text-[12px] font-bold text-background"
          >
            Connect
          </button>
        </motion.div>
      )}
      <div className="mt-4 rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-4 shadow-[var(--ds-card-shadow)]">
        <SwitchRow
          on={s.stories.enabled}
          onChange={(on) => set({ stories: { ...s.stories, enabled: on } })}
          label="Daily Stories too"
          detail="Short Instagram and Facebook Stories in your look, made the day before."
        />
      </div>
    </>
  );
}

function RhythmStep({
  s,
  set,
}: {
  s: ProgramSettings;
  set: (patch: Partial<ProgramSettings>) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <>
      <div role="radiogroup" aria-label="How often" className="grid grid-cols-3 gap-2.5">
        {PACES.map((p) => {
          const on =
            s.postsPerWeek === p.postsPerWeek &&
            p.weekdays.every((d) => s.weekdays.includes(d)) &&
            s.weekdays.length === p.weekdays.length;
          return (
            <Choice
              key={p.id}
              on={on}
              label={p.label}
              onClick={() => set({ postsPerWeek: p.postsPerWeek, weekdays: [...p.weekdays] })}
            >
              <span className="flex gap-[5px]" aria-hidden>
                {DAY_LETTERS.map((d, i) => (
                  <motion.span
                    key={i}
                    initial={reduce ? false : { scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.04 * i, type: "spring", stiffness: 420 }}
                    className={cn(
                      "grid size-[18px] place-items-center rounded-full text-[8.5px] font-bold sm:size-5",
                      (p.weekdays as readonly number[]).includes(i)
                        ? "bg-foreground text-background"
                        : "bg-[var(--ds-well-bg)] text-muted-foreground/60",
                    )}
                  >
                    {d}
                  </motion.span>
                ))}
              </span>
              <span className="mt-3 text-[15px] font-bold leading-tight">{p.label}</span>
              <span className="mt-0.5 text-[12px] text-muted-foreground">{p.line}</span>
            </Choice>
          );
        })}
      </div>

      <p className="ds-label mb-2.5 mt-6">What Mox makes</p>
      <div
        role="group"
        aria-label="What Mox makes"
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-5"
      >
        {AUTOPILOT_TYPES.map((t) => {
          const on = s.contentTypes.includes(t);
          return (
            <Choice
              key={t}
              role="checkbox"
              on={on}
              label={STUDIO_FORMATS[t].label}
              onClick={() => {
                const next = toggle(s.contentTypes, t);
                set({
                  contentTypes: next,
                  videoCapPerWeek: next.includes("video") ? Math.max(1, s.videoCapPerWeek) : 0,
                });
              }}
              className="items-center p-3 text-center"
            >
              <Illustration
                kind={TYPE_ILLO[t]}
                className="h-14 w-16 transition-transform duration-300 group-hover/choice:-translate-y-0.5 group-hover/choice:rotate-[-3deg]"
              />
              <span className="mt-1.5 w-full text-center text-[12.5px] font-bold">
                {STUDIO_FORMATS[t].label}
              </span>
            </Choice>
          );
        })}
      </div>
    </>
  );
}

function ApprovalStep({
  s,
  set,
  fullAvailable,
  suggested,
}: {
  s: ProgramSettings;
  set: (patch: Partial<ProgramSettings>) => void;
  fullAvailable: boolean;
  suggested: AutopilotMode | undefined;
}) {
  const modes: AutopilotMode[] = ["autopilot", "full", "assist"];
  return (
    <div role="radiogroup" aria-label="Who approves" className="grid gap-2.5 sm:grid-cols-3">
      {modes.map((mode) => {
        const Icon = MODE_LOOK[mode];
        const locked = mode === "full" && !fullAvailable;
        return (
          <Choice
            key={mode}
            on={s.mode === mode}
            disabled={locked}
            label={MODE_INFO[mode].label}
            onClick={() => set({ mode })}
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-[var(--ds-well-bg)] text-foreground/80">
              <Icon className="size-5" />
            </span>
            {suggested === mode && (
              <span className="ds-grad-pill mt-3 rounded-full px-2 py-0.5 text-[10px] font-bold">
                Mox suggests
              </span>
            )}
            <span className="mt-2 text-[14px] font-bold leading-tight">
              {MODE_INFO[mode].label}
            </span>
            <span className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {locked ? "Not available for this workspace." : MODE_INFO[mode].detail}
            </span>
          </Choice>
        );
      })}
    </div>
  );
}

function Recap({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Change ${label.toLowerCase()}`}
      className="group/recap flex min-w-0 flex-col items-start rounded-[18px] bg-[var(--ds-well-bg)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--ds-card-bg)] hover:shadow-[var(--ds-card-shadow)]"
    >
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <span className="mt-1 flex min-h-6 w-full min-w-0 items-center gap-1.5 truncate text-[13.5px] font-bold">
        {children}
      </span>
    </button>
  );
}

const WORKS_WITH: { icon: ComponentType<{ className?: string }>; line: string }[] = [
  { icon: CalendarDays, line: "Fills your calendar, never your days" },
  { icon: Megaphone, line: "Plans around your campaigns" },
  { icon: Palette, line: "Made in your Inspo look" },
  { icon: ImageIcon, line: "Everything saved to Library" },
];

function ReadyStep({
  s,
  setS,
  suggestion,
  connected,
  fullAvailable,
  readiness,
  onOpen,
  blogHost,
  goTo,
}: {
  s: ProgramSettings;
  setS: (next: ProgramSettings) => void;
  suggestion: NonNullable<SuggestionState["data"]>;
  connected: PlatformId[];
  fullAvailable: boolean;
  readiness: ReadinessItem[];
  onOpen: (target: ReadinessItem["id"]) => void;
  blogHost?: string | null;
  goTo: (step: StepId) => void;
}) {
  const [tune, setTune] = useState(false);
  const strategy = s.strategy ?? suggestion.strategy;
  const pace =
    PACES.find((p) => p.postsPerWeek === s.postsPerWeek)?.label ?? `${s.postsPerWeek} a week`;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Recap label="Goal" onEdit={() => goTo("goal")}>
          <span className="truncate">
            {PLAN_GOALS.find((g) => g.id === s.goal)?.label ?? s.goal}
          </span>
        </Recap>
        <Recap label="Channels" onEdit={() => goTo("channels")}>
          {s.platforms.map((p) => {
            const Icon = PLATFORMS[p].icon;
            return <Icon key={p} className="size-4 shrink-0" />;
          })}
        </Recap>
        <Recap label="Rhythm" onEdit={() => goTo("rhythm")}>
          <span className="truncate">{pace}</span>
        </Recap>
        <Recap label="Approval" onEdit={() => goTo("approval")}>
          <span className="truncate">{MODE_INFO[s.mode].label}</span>
        </Recap>
      </div>

      {strategy?.summary && (
        <div className="mt-3 rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-4 shadow-[var(--ds-card-shadow)]">
          <div className="flex items-center justify-between gap-3">
            <p className="ds-label">Your strategy</p>
            <span className="text-[11px] text-muted-foreground">
              {suggestion.source === "model" ? "From your Brand DNA" : "A starting point"}
            </span>
          </div>
          <p className="mt-1.5 text-[14px] font-medium leading-relaxed">{strategy.summary}</p>
          {strategy.pillars.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {strategy.pillars.map((p) => (
                <li
                  key={p.title}
                  className="rounded-full bg-[var(--ds-well-bg)] px-3 py-1 text-[12px] font-semibold"
                >
                  {p.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Works with">
        {WORKS_WITH.map(({ icon: Icon, line }, i) => (
          <motion.li
            key={line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06, duration: 0.35, ease: EASE }}
            className="flex items-center gap-2 rounded-[16px] px-2 py-1.5 text-[11.5px] font-medium leading-tight text-muted-foreground"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-foreground/75">
              <Icon className="size-3.5" />
            </span>
            {line}
          </motion.li>
        ))}
      </ul>

      {readiness.some((r) => !r.ok) && (
        <div className="mt-4">
          <p className="ds-label mb-2">Connect first</p>
          <Readiness items={readiness} onOpen={onOpen} />
        </div>
      )}

      <button
        type="button"
        aria-expanded={tune}
        onClick={() => setTune((v) => !v)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
      >
        Fine-tune
        <ChevronDown className={cn("size-3.5 transition-transform", tune && "rotate-180")} />
      </button>
      {tune && (
        <div className="ds-enter mt-2">
          <SettingRows
            s={s}
            onChange={setS}
            connected={connected}
            fullAvailable={fullAvailable}
            blogHost={blogHost}
          />
        </div>
      )}
    </>
  );
}

/* ───────────────────────── the wizard ───────────────────────── */

export function AutopilotWizard({
  suggestion,
  connected,
  fullAvailable,
  busy,
  onStart,
  readiness,
  onOpen,
  blogHost,
}: {
  suggestion: SuggestionState;
  connected: PlatformId[];
  fullAvailable: boolean;
  busy: boolean;
  onStart: (settings: ProgramSettings) => void;
  readiness: ReadinessItem[];
  onOpen: (target: ReadinessItem["id"]) => void;
  blogHost?: string | null;
}) {
  const reduce = useReducedMotion();
  const [s, setS] = useState<ProgramSettings | null>(suggestion.data?.settings ?? null);
  const [step, setStep] = useState<StepId>("goal");
  const [dir, setDir] = useState(1);
  useEffect(() => {
    if (suggestion.data && !s) setS(suggestion.data.settings);
  }, [suggestion.data, s]);
  const estimate = useMemo(() => (s ? weeklyEstimate(s) : 0), [s]);

  const at = STEPS.findIndex((x) => x.id === step);
  const goTo = (next: StepId) => {
    setDir(STEPS.findIndex((x) => x.id === next) >= at ? 1 : -1);
    setStep(next);
  };

  if (!s || !suggestion.data) {
    return (
      <div className="mx-auto max-w-[720px] px-4 pb-10 pt-8" aria-busy={!suggestion.failed}>
        <div className="flex items-center gap-3">
          <span className="mox-float shrink-0">
            <MoxFace mood={suggestion.failed ? "sad" : "scanning"} size={52} />
          </span>
          <h3 className="text-[24px] font-bold leading-tight tracking-[-0.025em]">
            {suggestion.failed ? (
              "I couldn't read your brand just now."
            ) : (
              <>
                Reading your brand<span className="ds-grad-text">…</span>
              </>
            )}
          </h3>
        </div>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          {suggestion.failed
            ? "Try again in a moment."
            : "Mox suggests every answer, so setting up takes a minute."}
        </p>
        {!suggestion.failed && (
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[120px] rounded-[22px]" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const set = (patch: Partial<ProgramSettings>) => setS({ ...s, ...patch });
  const stepOk =
    step === "channels"
      ? s.platforms.length > 0
      : step === "rhythm"
        ? s.contentTypes.length > 0 && (s.postsPerWeek > 0 || s.stories.enabled)
        : true;
  const blocked =
    busy || !settingsValid(s) || (s.mode === "full" && readiness.some((r) => r.required && !r.ok));
  const last = step === "ready";

  return (
    <div className="relative mx-auto flex min-h-full max-w-[760px] flex-col px-4 pb-28 pt-4 sm:pt-6">
      <div className="flex flex-col items-center gap-2.5">
        <StepPills
          steps={STEPS.map((x) => ({ id: x.id, label: x.label }))}
          current={step}
          onPick={(id) => goTo(id as StepId)}
          className="max-w-full overflow-x-auto"
        />
        <GradProgress
          value={(at + 1) / STEPS.length}
          className="w-full max-w-[320px]"
          label="Setup progress"
        />
      </div>

      <div className="mt-7">
        <StepHead step={step} />
      </div>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 * dir }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 * dir }}
          transition={{ duration: 0.28, ease: EASE }}
          className="mt-5"
        >
          {step === "goal" && <GoalStep s={s} set={set} />}
          {step === "channels" && (
            <ChannelsStep s={s} set={set} connected={connected} onOpen={onOpen} />
          )}
          {step === "rhythm" && <RhythmStep s={s} set={set} />}
          {step === "approval" && (
            <ApprovalStep
              s={s}
              set={set}
              fullAvailable={fullAvailable}
              suggested={suggestion.data.settings.mode}
            />
          )}
          {step === "ready" && (
            <ReadyStep
              s={s}
              setS={setS}
              suggestion={suggestion.data}
              connected={connected}
              fullAvailable={fullAvailable}
              readiness={readiness}
              onOpen={onOpen}
              blogHost={blogHost}
              goTo={goTo}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Back on the left, the next step floating bottom right (Studio's Generate). */}
      <div className="pointer-events-none sticky bottom-0 mt-auto flex items-end justify-between gap-3 pt-6">
        <span className="pointer-events-auto">
          {at > 0 && <BackPill onClick={() => goTo(STEPS[at - 1].id)} />}
        </span>
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          {last && (
            <span className="rounded-full bg-[var(--ds-card-bg)]/80 px-2.5 py-0.5 text-[11.5px] text-muted-foreground backdrop-blur">
              About {estimate} credits a week · pause anytime
            </span>
          )}
          <button
            type="button"
            disabled={last ? blocked : !stepOk}
            onClick={() => (last ? onStart(s) : goTo(STEPS[at + 1].id))}
            className="studio-cta inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14.5px] font-bold shadow-[var(--ds-card-shadow-hover)] disabled:opacity-50"
          >
            {last ? (busy ? "Turning on…" : "Turn on Autopilot") : "Next"}
            {!busy && <ArrowRight className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
