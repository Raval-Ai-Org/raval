"use client";
// One-time setup. Mellox proposes a strategy and the settings from Brand DNA;
// the person reads one screen and presses one button. Every setting is a row
// that opens in place, so nothing has to be filled in to get started. The same
// rows are the Settings page afterwards.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Bot, Check, ChevronDown } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { dsPrimaryBtn } from "@/components/app/surface/buttons";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import {
  AUTOMATION_INFO,
  AUTOMATIONS,
  AUTOPILOT_MODES,
  AUTOPILOT_TYPES,
  MODE_INFO,
  type AutopilotMode,
  type ProgramSettings,
  type ProgramView,
  type ReadinessItem,
  type Strategy,
  type StrategySuggestion,
} from "@/lib/autopilot/contracts";
import { estimateCost } from "@/lib/autopilot/policy";
import { PLAN_GOALS } from "@/lib/calendar/planner";
import { PLATFORM_ORDER, PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { STORY_THEMES, type StoryThemeId } from "@/lib/stories/frames";
import { STORY_PLATFORMS } from "@/lib/stories/placement";
import { storyTimes, toMinutes, type StorySettings } from "@/lib/stories/schedule";
import { Chip, SwitchRow } from "./autopilot-ui";
import { Readiness } from "./Readiness";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PACES: { id: string; label: string; postsPerWeek: number; weekdays: number[] }[] = [
  { id: "daily", label: "Every day", postsPerWeek: 7, weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { id: "weekdays", label: "Every weekday", postsPerWeek: 5, weekdays: [1, 2, 3, 4, 5] },
  { id: "three", label: "3 times a week", postsPerWeek: 3, weekdays: [1, 3, 5] },
];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Roughly what a week costs at this pace. */
export function weeklyEstimate(
  settings: Pick<ProgramSettings, "contentTypes" | "postsPerWeek"> &
    Partial<Pick<ProgramSettings, "stories">>,
): number {
  const st = settings.stories;
  const stories = st?.enabled
    ? estimateCost("story").credits * st.perDay * (st.days.length || 7)
    : 0;
  const social = settings.contentTypes.filter((t) => t !== "article" && t !== "video");
  const perPost = social.length
    ? social.reduce((n, t) => n + estimateCost(t).credits, 0) / social.length
    : estimateCost("social").credits;
  const article = settings.contentTypes.includes("article") ? estimateCost("article").credits : 0;
  return Math.ceil(perPost * settings.postsPerWeek + article + stories);
}

export function settingsFromProgram(program: ProgramView): ProgramSettings {
  return {
    mode: program.mode,
    goal: program.goal as ProgramSettings["goal"],
    goalNote: program.goalNote,
    platforms: program.platforms,
    contentTypes: program.contentTypes,
    postsPerWeek: program.postsPerWeek,
    weekdays: program.weekdays,
    timezone: program.timezone,
    weeks: program.totalWeeks,
    creditCapPerWeek: program.creditCapPerWeek,
    videoCapPerWeek: program.videoCapPerWeek,
    actOnOpportunities: program.actOnOpportunities,
    strategy: program.strategy,
    automations: program.automations,
    stories: program.stories,
  };
}

function storiesLabel(st: StorySettings): string {
  if (!st.enabled) return "Off";
  const days = st.days.length && st.days.length < 7 ? `${st.days.length} days a week` : "every day";
  return `${st.perDay} a day, ${days}`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function paceLabel(s: Pick<ProgramSettings, "postsPerWeek" | "weekdays">): string {
  const preset = PACES.find(
    (p) =>
      p.postsPerWeek === s.postsPerWeek &&
      p.weekdays.length === s.weekdays.length &&
      p.weekdays.every((d) => s.weekdays.includes(d)),
  );
  return preset?.label ?? `${s.postsPerWeek} ${s.postsPerWeek === 1 ? "post" : "posts"} a week`;
}

/* ───────────────────────── strategy card ───────────────────────── */

export function StrategyCard({
  strategy,
  note,
  compact,
}: {
  strategy: Strategy;
  note?: string;
  compact?: boolean;
}) {
  return (
    <Tile>
      <div className="flex items-center justify-between gap-3">
        <p className="ds-label">Your strategy</p>
        {note && <span className="text-[11.5px] text-muted-foreground">{note}</span>}
      </div>
      <p className="mt-2 text-[15px] font-medium leading-relaxed">{strategy.summary}</p>
      {!compact && (strategy.audience || strategy.voice) && (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {strategy.audience && (
            <div>
              <dt className="text-muted-foreground">Who it&apos;s for</dt>
              <dd>{strategy.audience}</dd>
            </div>
          )}
          {strategy.voice && (
            <div>
              <dt className="text-muted-foreground">How it sounds</dt>
              <dd>{strategy.voice}</dd>
            </div>
          )}
        </dl>
      )}
      <ul className={cn("mt-4 grid gap-2", !compact && "sm:grid-cols-2")}>
        {strategy.pillars.map((pillar) => (
          <li key={pillar.title} className="ds-well rounded-[var(--ds-radius-well)] px-3.5 py-3">
            <p className="text-[13.5px] font-semibold">{pillar.title}</p>
            {!compact && pillar.detail && (
              <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                {pillar.detail}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/* ───────────────────────── setting rows ───────────────────────── */

type RowId = "goal" | "where" | "pace" | "what" | "stories" | "mode" | "also" | "limit";

function Row({
  id,
  open,
  onToggle,
  label,
  value,
  children,
}: {
  id: RowId;
  open: boolean;
  onToggle: (id: RowId) => void;
  label: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-5"
      >
        <span className="w-[104px] shrink-0 text-[13px] text-muted-foreground sm:w-[132px]">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{value}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="ds-enter space-y-3 px-4 pb-5 pt-1 sm:px-5">{children}</div>}
    </li>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-snug text-muted-foreground">{children}</p>;
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        className="ds-well h-10 w-28 rounded-full border-0 px-4 text-[14px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {suffix && <span className="text-[13px] text-muted-foreground">{suffix}</span>}
    </label>
  );
}

export function SettingRows({
  s,
  onChange,
  connected,
  fullAvailable,
  blogHost,
}: {
  s: ProgramSettings;
  onChange: (next: ProgramSettings) => void;
  connected: PlatformId[];
  fullAvailable: boolean;
  /** The blog approved articles can go to, when one is connected. */
  blogHost?: string | null;
}) {
  const [open, setOpen] = useState<RowId | null>(null);
  const toggleRow = (id: RowId) => setOpen((cur) => (cur === id ? null : id));
  const set = <K extends keyof ProgramSettings>(key: K, value: ProgramSettings[K]) =>
    onChange({ ...s, [key]: value });
  const estimate = weeklyEstimate(s);
  const hasVideo = s.contentTypes.includes("video");
  const unlinked = s.platforms.filter((p) => !connected.includes(p));

  return (
    <Tile className="overflow-hidden p-0 sm:p-0">
      <ul className="divide-y divide-border/50">
        <Row
          id="goal"
          open={open === "goal"}
          onToggle={toggleRow}
          label="Goal"
          value={PLAN_GOALS.find((g) => g.id === s.goal)?.label ?? s.goal}
        >
          <div className="flex flex-wrap gap-2">
            {PLAN_GOALS.map((g) => (
              <Chip key={g.id} active={s.goal === g.id} onClick={() => set("goal", g.id)}>
                {g.label}
              </Chip>
            ))}
          </div>
          <textarea
            value={s.goalNote}
            onChange={(e) => set("goalNote", e.target.value.slice(0, 600))}
            rows={2}
            aria-label="Anything Mellox should know"
            placeholder="Anything Mellox should know? e.g. We open a second shop on the 20th"
            className="ds-well w-full resize-none rounded-[var(--ds-radius-well)] border-0 px-4 py-3 text-[14px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </Row>

        <Row
          id="where"
          open={open === "where"}
          onToggle={toggleRow}
          label="Where"
          value={
            s.platforms.length ? (
              s.platforms.map((p) => PLATFORMS[p].label).join(", ")
            ) : (
              <span className="text-warning">Pick at least one</span>
            )
          }
        >
          <div className="flex flex-wrap gap-2">
            {PLATFORM_ORDER.map((id) => (
              <Chip
                key={id}
                active={s.platforms.includes(id)}
                onClick={() => set("platforms", toggle(s.platforms, id).slice(0, 5))}
              >
                {PLATFORMS[id].label}
                {!connected.includes(id) && (
                  <span className="text-[11px] font-normal text-muted-foreground">
                    not connected
                  </span>
                )}
              </Chip>
            ))}
          </div>
          {unlinked.length > 0 && (
            <Hint>
              {unlinked.map((p) => PLATFORMS[p].label).join(" and ")}{" "}
              {unlinked.length === 1 ? "isn't" : "aren't"} connected yet. Connect it in Settings
              before the first post is due, or that post won&apos;t go out.
            </Hint>
          )}
        </Row>

        <Row
          id="pace"
          open={open === "pace"}
          onToggle={toggleRow}
          label="How often"
          value={paceLabel(s)}
        >
          <div className="flex flex-wrap gap-2">
            {PACES.map((p) => (
              <Chip
                key={p.id}
                active={paceLabel(s) === p.label}
                onClick={() =>
                  onChange({ ...s, postsPerWeek: p.postsPerWeek, weekdays: p.weekdays })
                }
              >
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-1">
            <NumberInput
              label="Posts a week"
              value={s.postsPerWeek}
              min={s.stories.enabled ? 0 : 1}
              max={14}
              suffix="posts a week"
              onChange={(n) => set("postsPerWeek", n)}
            />
            <div className="flex gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={DAY_NAMES[i]}
                  aria-pressed={s.weekdays.includes(i)}
                  onClick={() => set("weekdays", toggle(s.weekdays, i).sort())}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full border text-[12.5px] font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    s.weekdays.includes(i)
                      ? "border-primary/40 bg-primary/12 text-foreground"
                      : "border-border/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <Hint>Times follow {s.timezone.replace(/_/g, " ")}.</Hint>
        </Row>

        <Row
          id="what"
          open={open === "what"}
          onToggle={toggleRow}
          label="What"
          value={
            s.contentTypes.length ? (
              s.contentTypes.map((t) => STUDIO_FORMATS[t].label).join(", ")
            ) : (
              <span className="text-warning">Pick at least one</span>
            )
          }
        >
          <div className="flex flex-wrap gap-2">
            {AUTOPILOT_TYPES.map((t) => (
              <Chip
                key={t}
                active={s.contentTypes.includes(t)}
                onClick={() => {
                  const next = toggle(s.contentTypes, t);
                  onChange({
                    ...s,
                    contentTypes: next,
                    videoCapPerWeek: next.includes("video") ? Math.max(1, s.videoCapPerWeek) : 0,
                  });
                }}
              >
                {STUDIO_FORMATS[t].label}
              </Chip>
            ))}
          </div>
          {hasVideo && (
            <NumberInput
              label="Video limit per week"
              value={s.videoCapPerWeek}
              min={1}
              max={50}
              suffix="videos a week at most"
              onChange={(n) => set("videoCapPerWeek", n)}
            />
          )}
        </Row>

        <Row
          id="stories"
          open={open === "stories"}
          onToggle={toggleRow}
          label="Stories"
          value={storiesLabel(s.stories)}
        >
          <StoriesSettings
            value={s.stories}
            connected={connected}
            timezone={s.timezone}
            onChange={(stories) => set("stories", stories)}
          />
        </Row>

        <Row
          id="mode"
          open={open === "mode"}
          onToggle={toggleRow}
          label="Who approves"
          value={MODE_INFO[s.mode].label}
        >
          <div className="space-y-2">
            {(["full", "autopilot", "assist"] satisfies AutopilotMode[]).map((mode) => {
              if (!AUTOPILOT_MODES.includes(mode)) return null;
              const locked = mode === "full" && !fullAvailable;
              const on = s.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={locked}
                  onClick={() => set("mode", mode)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[var(--ds-radius-well)] border px-4 py-3 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
                    on
                      ? "border-primary/50 bg-primary/[0.08]"
                      : "border-border/70 hover:bg-[var(--ds-well-bg)]",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold">{MODE_INFO[mode].label}</span>
                    <span className="block text-[12.5px] leading-snug text-muted-foreground">
                      {locked ? "Not available for this workspace." : MODE_INFO[mode].detail}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {s.mode === "full" && (
            <Hint>
              Only plain posts, image posts and Stories go out by themselves (two posts a day at
              most, plus your daily Stories), and only when they state nothing Mellox can&apos;t
              find in your Brand DNA. We email you when something waits.
            </Hint>
          )}
          <div className="pt-1">
            <SwitchRow
              on={s.actOnOpportunities}
              onChange={(on) => set("actOnOpportunities", on)}
              label="Respond to what's happening"
              detail="When a competitor move or trend clearly matters, Mellox adds a post about it. Up to two a week."
            />
          </div>
        </Row>

        <Row
          id="also"
          open={open === "also"}
          onToggle={toggleRow}
          label="Also"
          value={
            s.automations.length
              ? AUTOMATIONS.filter((a) => s.automations.includes(a))
                  .map((a) => AUTOMATION_INFO[a].label)
                  .join(", ")
              : "Posts only"
          }
        >
          <div className="space-y-3.5">
            {AUTOMATIONS.map((a) => (
              <SwitchRow
                key={a}
                on={s.automations.includes(a)}
                onChange={() => set("automations", toggle(s.automations, a))}
                label={AUTOMATION_INFO[a].label}
                detail={AUTOMATION_INFO[a].detail}
                note={
                  a === "publish_articles"
                    ? !s.contentTypes.includes("article")
                      ? "Add Article under What, or there is nothing to send."
                      : !blogHost
                        ? "No blog is connected yet. Articles stay in your content until one is."
                        : undefined
                    : undefined
                }
              />
            ))}
          </div>
          <Hint>
            {blogHost && s.automations.includes("publish_articles")
              ? `Articles go to ${blogHost} only after you approve them. `
              : ""}
            Market and competitor watching is always on and feeds your ideas.
          </Hint>
        </Row>

        <Row
          id="limit"
          open={open === "limit"}
          onToggle={toggleRow}
          label="Weekly limit"
          value={`${s.creditCapPerWeek} credits`}
        >
          <NumberInput
            label="Credit limit per week"
            value={s.creditCapPerWeek}
            min={0}
            max={100_000}
            step={10}
            suffix="credits a week at most"
            onChange={(n) => set("creditCapPerWeek", n)}
          />
          <Hint>
            This pace uses about {estimate} credits a week. Each post costs the same as making it
            yourself.
            {s.creditCapPerWeek < estimate && " Below this pace, some posts will be skipped."}
          </Hint>
        </Row>
      </ul>
    </Tile>
  );
}

export function settingsValid(s: ProgramSettings): boolean {
  const st = s.stories;
  return (
    s.platforms.length > 0 &&
    s.contentTypes.length > 0 &&
    (!s.contentTypes.includes("video") || s.videoCapPerWeek > 0) &&
    (s.postsPerWeek > 0 || st.enabled) &&
    (!st.enabled ||
      (st.platforms.length > 0 &&
        st.themes.length > 0 &&
        toMinutes(st.windowEnd) - toMinutes(st.windowStart) >= 60))
  );
}

/** Story Autopilot: how many a day, when, where and about what. */
function StoriesSettings({
  value: st,
  onChange,
  connected,
  timezone,
}: {
  value: StorySettings;
  onChange: (next: StorySettings) => void;
  connected: PlatformId[];
  timezone: string;
}) {
  const set = <K extends keyof StorySettings>(key: K, v: StorySettings[K]) =>
    onChange({ ...st, [key]: v });
  const { times } = storyTimes({
    windowStart: st.windowStart,
    windowEnd: st.windowEnd,
    perDay: st.perDay,
  });
  const windowOk = toMinutes(st.windowEnd) - toMinutes(st.windowStart) >= 60;
  const timeInput =
    "ds-well h-10 rounded-full border-0 px-4 text-[14px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <>
      <SwitchRow
        on={st.enabled}
        onChange={(on) => set("enabled", on)}
        label="Post Stories every day"
        detail="Short Instagram and Facebook Stories in your brand look, made the day before so you can check them."
      />

      {st.enabled && (
        <>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((n) => (
              <Chip key={n} active={st.perDay === n} onClick={() => set("perDay", n)}>
                {n} a day
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {STORY_PLATFORMS.map((id) => (
              <Chip
                key={id}
                active={st.platforms.includes(id)}
                onClick={() => {
                  const next = toggle(st.platforms, id);
                  if (next.length) set("platforms", next);
                }}
              >
                {PLATFORMS[id].label}
                {!connected.includes(id) && (
                  <span className="text-[11px] font-normal text-muted-foreground">
                    not connected
                  </span>
                )}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13px] text-muted-foreground">Between</span>
            <input
              type="time"
              aria-label="Earliest Story time"
              value={st.windowStart}
              onChange={(e) => e.target.value && set("windowStart", e.target.value)}
              className={timeInput}
            />
            <span className="text-[13px] text-muted-foreground">and</span>
            <input
              type="time"
              aria-label="Latest Story time"
              value={st.windowEnd}
              onChange={(e) => e.target.value && set("windowEnd", e.target.value)}
              className={timeInput}
            />
          </div>
          {windowOk ? (
            <Hint>
              Goes out around {times.join(", ")} ({timezone.replace(/_/g, " ")}).
            </Hint>
          ) : (
            <p className="text-[12.5px] text-warning">Leave at least an hour between the two.</p>
          )}

          <div className="flex gap-1.5">
            {DAYS.map((d, i) => {
              const on = !st.days.length || st.days.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={DAY_NAMES[i]}
                  aria-pressed={on}
                  onClick={() => {
                    const all = st.days.length ? st.days : [0, 1, 2, 3, 4, 5, 6];
                    const next = toggle(all, i).sort();
                    if (next.length) set("days", next.length === 7 ? [] : next);
                  }}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full border text-[12.5px] font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    on
                      ? "border-primary/40 bg-primary/12 text-foreground"
                      : "border-border/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div>
            <p className="mb-2 text-[13px] text-muted-foreground">What they&apos;re about</p>
            <div className="flex flex-wrap gap-2">
              {STORY_THEMES.filter((t) => t.id !== "repurpose").map((t) => (
                <Chip
                  key={t.id}
                  active={st.themes.includes(t.id)}
                  onClick={() => {
                    const next = toggle<StoryThemeId>(st.themes, t.id);
                    if (next.length) set("themes", next);
                  }}
                >
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Frames in each</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip key={n} active={st.frames === n} onClick={() => set("frames", n)}>
                {n}
              </Chip>
            ))}
          </div>

          <SwitchRow
            on={st.smartTiming}
            onChange={(on) => set("smartTiming", on)}
            label="Pick the best times for me"
            detail="Once your Stories have numbers, Mellox moves them to the hours they were seen most."
          />
          <Hint>
            Stories can&apos;t carry link, poll or music stickers when an app posts them. Mellox
            writes &quot;link in bio&quot; and asks for replies instead.
          </Hint>
        </>
      )}
    </>
  );
}

/* ───────────────────────── first-time setup ───────────────────────── */

export type SuggestionState = {
  data?: StrategySuggestion;
  loading: boolean;
  failed: boolean;
};

export function AutopilotSetup({
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
  const [s, setS] = useState<ProgramSettings | null>(suggestion.data?.settings ?? null);
  useEffect(() => {
    if (suggestion.data && !s) setS(suggestion.data.settings);
  }, [suggestion.data, s]);
  const estimate = useMemo(() => (s ? weeklyEstimate(s) : 0), [s]);

  return (
    <SurfacePage width="narrow">
      <div className="ds-enter mx-auto max-w-[640px] pb-4 pt-2">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/12 text-primary">
          <Bot className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-[26px] font-semibold leading-tight tracking-tight">
          Let Mellox run your marketing
        </h3>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">
          Set it up once. Mellox plans, writes, posts and learns, every week.
        </p>

        {!s || !suggestion.data ? (
          <div className="mt-7 space-y-3" aria-busy="true">
            <p className="text-[13px] text-muted-foreground">
              {suggestion.failed
                ? "We couldn't read your brand just now. Try again in a moment."
                : "Reading your brand and writing a strategy…"}
            </p>
            {!suggestion.failed && (
              <>
                <Skeleton className="h-40 w-full rounded-[var(--ds-radius-tile)]" />
                <Skeleton className="h-64 w-full rounded-[var(--ds-radius-tile)]" />
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mt-7">
              <StrategyCard
                strategy={s.strategy ?? suggestion.data.strategy}
                note={
                  suggestion.data.source === "model"
                    ? "Written from your Brand DNA"
                    : "A starting point. Add your Brand DNA for a sharper one."
                }
              />
            </div>
            {readiness.some((r) => !r.ok) && (
              <>
                <p className="ds-label mb-2.5 mt-6">Connect first</p>
                <Readiness items={readiness} onOpen={onOpen} />
              </>
            )}
            <p className="ds-label mb-2.5 mt-6">How it will run</p>
            <SettingRows
              s={s}
              onChange={setS}
              connected={connected}
              fullAvailable={fullAvailable}
              blogHost={blogHost}
            />
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
              <button
                type="button"
                disabled={
                  busy ||
                  !settingsValid(s) ||
                  (s.mode === "full" && readiness.some((item) => item.required && !item.ok))
                }
                onClick={() => onStart(s)}
                className={cn(dsPrimaryBtn, "h-12 px-7 text-[15px]")}
              >
                {busy ? "Turning on…" : "Turn on Autopilot"}
              </button>
              <p className="text-[12.5px] text-muted-foreground">
                About {estimate} credits a week. Pause or change it anytime.
              </p>
            </div>
          </>
        )}
      </div>
    </SurfacePage>
  );
}
