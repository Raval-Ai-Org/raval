"use client";

// Autopilot — everything a person sees, drawn from one view object and a set
// of handlers. It holds no data of its own, so the real panel and the dev-only
// lab page render exactly the same screen.
import { useState, type ReactNode } from "react";
import { motion, MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Bot,
  Check,
  ExternalLink,
  Eye,
  History,
  Lightbulb,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Story,
  TrendingUp,
  X,
} from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  GroupLabel,
  SurfaceLayout,
  SurfacePage,
  Tile,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import {
  OPPORTUNITY_FORMATS,
  type AutopilotView,
  type OpportunityFormat,
  type OpportunityView,
  type ProgramSettings,
} from "@/lib/autopilot/contracts";
import { AUTO_ACT_SCORE } from "@/lib/autopilot/opportunities";
import { pauseReasonText } from "@/lib/autopilot/status";
import type { PlatformId } from "@/lib/social-platforms";
import {
  AutopilotSetup,
  SettingRows,
  settingsFromProgram,
  settingsValid,
  StrategyCard,
  type SuggestionState,
} from "./AutopilotSetup";
import {
  ActionLine,
  Chip,
  Dot,
  KIND_LABEL,
  pieceLabel,
  StatusPill,
  timeAgo,
  whenLabel,
} from "./autopilot-ui";
import { Readiness } from "./Readiness";
import { Pipeline, rise, ScoreRing, Timeline, WeekStrip } from "./visuals";

export type OpenTarget = "accounts" | "brand" | "website" | "visibility" | "calendar";

export type AutopilotHandlers = {
  start: (settings: ProgramSettings) => void;
  update: (settings: ProgramSettings) => void;
  pause: (paused: boolean) => void;
  stop: () => void;
  approvePlan: () => void;
  decide: (actionId: string, decision: "approve" | "skip") => void;
  retry: (actionId: string) => void;
  opportunity: (args: {
    opportunityId: string;
    decision: "create" | "dismiss";
    format?: OpportunityFormat;
    platform?: PlatformId;
  }) => void;
  /** Go to the place in Mellox where something is connected, fixed or edited. */
  open: (target: OpenTarget) => void;
  busy: boolean;
};

export type Section = "home" | "approvals" | "ideas" | "activity" | "settings";

const FORMAT_LABEL: Record<OpportunityFormat, string> = {
  social: "Post",
  image: "Image post",
  carousel: "Carousel",
  story: "Story",
  video: "Video",
  article: "Article",
  campaign: "Small campaign",
};

export function AutopilotScreen({
  view,
  handlers,
  suggestion,
  initialSection = "home",
}: {
  view: AutopilotView;
  handlers: AutopilotHandlers;
  suggestion: SuggestionState;
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);

  // Before it is switched on there is one thing to do, so there is one screen.
  if (!view.program) {
    if (!view.canManage) {
      return (
        <SurfacePage width="narrow">
          <EmptyState
            icon={Bot}
            title="Autopilot is off"
            description="An admin of this workspace can turn it on."
          />
        </SurfacePage>
      );
    }
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <AutopilotSetup
          suggestion={suggestion}
          connected={view.connectedPlatforms}
          fullAvailable={view.fullAvailable}
          busy={handlers.busy}
          onStart={handlers.start}
          readiness={view.readiness}
          onOpen={handlers.open}
        />
      </div>
    );
  }

  const waiting = view.approvals.length + (view.proposed.length ? 1 : 0);
  const items: SurfaceNavItem<Section>[] = [
    { id: "home", label: "Home", icon: Bot },
    { id: "approvals", label: "To approve", icon: ListChecks, count: waiting, highlight: true },
    { id: "ideas", label: "Ideas", icon: Lightbulb, count: view.opportunities.length },
    { id: "activity", label: "Activity", icon: History, count: view.failed.length },
    ...(view.canManage ? [{ id: "settings" as const, label: "Settings", icon: Settings }] : []),
  ];

  return (
    <MotionConfig reducedMotion="user">
      <SurfaceLayout items={items} value={section} onChange={setSection} label="Autopilot">
        {section === "home" && <Home view={view} handlers={handlers} onSection={setSection} />}
        {section === "approvals" && <Approvals view={view} handlers={handlers} />}
        {section === "ideas" && <Ideas view={view} handlers={handlers} />}
        {section === "activity" && <Activity view={view} handlers={handlers} />}
        {section === "settings" && <SettingsPage view={view} handlers={handlers} />}
      </SurfaceLayout>
    </MotionConfig>
  );
}

/* ───────────────────────── home ───────────────────────── */

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

function Home({
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
  const waiting = view.approvals.length;
  const planning =
    !paused && !view.upcoming.length && !view.proposed.length && !view.approvals.length;
  const scanTask = view.tasks.find((t) => t.contentType === "geo_scan");
  const scans = program.automations.includes("geo_scan");
  const soon = [...view.approvals, ...view.upcoming]
    .sort((a, b) => (a.plannedFor ?? "").localeCompare(b.plannedFor ?? ""))
    .slice(0, 4);

  return (
    <SurfacePage width="narrow">
      <motion.div {...rise(0)}>
        <Tile>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2.5 text-[22px] font-semibold leading-tight tracking-tight">
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
          </div>
        </Tile>
      </motion.div>

      {/* Anything that stops real work comes first, with the button that fixes it. */}
      {view.readiness.some((r) => !r.ok) && (
        <motion.div {...rise(1)} className="mt-3">
          <Readiness items={view.readiness} onOpen={handlers.open} onlyMissing />
        </motion.div>
      )}

      {view.proposed.length > 0 && (
        <div className="mt-3">
          <ProposedPlan view={view} handlers={handlers} />
        </div>
      )}

      {waiting > 0 && (
        <motion.div {...rise(1)} className="mt-3">
          <Tile className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/12 text-warning">
                <ListChecks className="h-5 w-5" />
              </span>
              <p className="text-[15px] font-semibold">
                {waiting} {waiting === 1 ? "post needs" : "posts need"} your OK
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSection("approvals")}
              className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]")}
            >
              Review
            </button>
          </Tile>
        </motion.div>
      )}

      {view.failed.length > 0 && (
        <Tile className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/12 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-[14px] font-medium">
              {view.failed.length} {view.failed.length === 1 ? "step" : "steps"} didn&apos;t work
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSection("activity")}
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
          >
            See why
          </button>
        </Tile>
      )}

      <GroupLabel>Right now</GroupLabel>
      <Pipeline view={view} onApprove={() => onSection("approvals")} />

      <GroupLabel action={<More onClick={() => handlers.open("calendar")}>Open calendar</More>}>
        Next 7 days
      </GroupLabel>
      <WeekStrip view={view} />
      {soon.length > 0 && (
        <Tile className="mt-2 py-1 sm:py-1">
          <ul className="divide-y divide-border/50">
            {soon.map((a) => (
              <ActionLine key={a.id} action={a} />
            ))}
          </ul>
        </Tile>
      )}

      <GroupLabel>Also on Autopilot</GroupLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        {view.stories?.enabled && (
          <button
            type="button"
            onClick={() => onSection(view.stories?.waiting ? "approvals" : "settings")}
            className="ds-tile ds-tile-hover flex items-center gap-3.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
              <Story className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold">Daily Stories</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {view.stories.waiting
                  ? `${view.stories.waiting} waiting for your OK`
                  : view.stories.times.length
                    ? `Around ${view.stories.times.join(", ")}${view.stories.timing === "learned" ? " · your best times" : ""}`
                    : "Planned with next week"}
              </span>
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => handlers.open("visibility")}
          className="ds-tile ds-tile-hover flex items-center gap-3.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ScoreRing score={view.visibility?.score ?? null} />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold">AI visibility</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {!scans
                ? "Weekly check is off"
                : scanTask?.status === "skipped"
                  ? "Add your website to start"
                  : view.visibility?.scannedAt
                    ? `Checked ${timeAgo(view.visibility.scannedAt)} · weekly`
                    : "First check is running"}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onSection("ideas")}
          className="ds-tile ds-tile-hover flex items-center gap-3.5 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
            <Eye className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold">Market and competitors</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {view.opportunities.length
                ? `${view.opportunities.length} ${view.opportunities.length === 1 ? "idea" : "ideas"} found`
                : "Watching. Nothing new."}
            </span>
          </span>
        </button>
      </div>

      {view.learnings.length > 0 && (
        <>
          <GroupLabel>What Mellox learned</GroupLabel>
          <Tile>
            <ul className="space-y-2.5">
              {view.learnings.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-muted-foreground">Used in next week&apos;s plan.</p>
          </Tile>
        </>
      )}

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
    </SurfacePage>
  );
}

function ProposedPlan({ view, handlers }: { view: AutopilotView; handlers: AutopilotHandlers }) {
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

/* ───────────────────────── approvals ───────────────────────── */

function Approvals({ view, handlers }: { view: AutopilotView; handlers: AutopilotHandlers }) {
  return (
    <SurfacePage title="To approve" width="narrow">
      {view.proposed.length > 0 && (
        <div className="mb-3">
          <ProposedPlan view={view} handlers={handlers} />
        </div>
      )}
      {!view.approvals.length && !view.proposed.length && (
        <EmptyState
          icon={ListChecks}
          title="You're all caught up"
          description="New posts show up here a few days before they're due."
        />
      )}
      <div className="space-y-3">
        {view.approvals.map((a, i) => (
          <motion.div key={a.id} {...rise(i)}>
            <Tile as="article">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="ds-label">{pieceLabel(a)}</p>
                  <h4 className="mt-1 text-[15px] font-semibold leading-snug">
                    {a.preview?.title || a.title}
                  </h4>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
                  {whenLabel(a.plannedFor)}
                </span>
              </div>
              {a.preview?.frames?.length ? (
                <ul aria-label="Story frames" className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {a.preview.frames.map((src, k) => (
                    <li key={k} className="shrink-0">
                      <img
                        src={src}
                        alt={`Frame ${k + 1}`}
                        loading="lazy"
                        className="aspect-[9/16] w-[104px] rounded-xl object-cover ring-1 ring-border/60"
                      />
                    </li>
                  ))}
                </ul>
              ) : a.preview?.body ? (
                <p className="ds-well mt-3 line-clamp-[10] whitespace-pre-wrap rounded-[var(--ds-radius-well)] p-3.5 text-[13.5px] leading-relaxed">
                  {a.preview.body}
                </p>
              ) : null}
              {a.reason && (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">Why this: </span>
                  {a.reason}
                </p>
              )}
              {view.canEdit && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={handlers.busy}
                    onClick={() => handlers.decide(a.id, "approve")}
                    className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]")}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handlers.open("calendar")}
                    className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={handlers.busy}
                    onClick={() => handlers.decide(a.id, "skip")}
                    className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
                  >
                    Skip
                  </button>
                </div>
              )}
            </Tile>
          </motion.div>
        ))}
      </div>
    </SurfacePage>
  );
}

/* ───────────────────────── ideas ───────────────────────── */

function OpportunityCard({
  opportunity,
  view,
  handlers,
}: {
  opportunity: OpportunityView;
  view: AutopilotView;
  handlers: AutopilotHandlers;
}) {
  const [format, setFormat] = useState<OpportunityFormat>(opportunity.suggestedType);
  const [picking, setPicking] = useState(false);
  const visibility = opportunity.kind === "visibility";
  return (
    <Tile as="article">
      <div className="flex items-center justify-between gap-3">
        <p className="ds-label">{KIND_LABEL[opportunity.kind]}</p>
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {opportunity.score >= AUTO_ACT_SCORE ? "Strong match" : "Good match"} ·{" "}
          {timeAgo(opportunity.createdAt)}
        </span>
      </div>
      <h4 className="mt-1.5 text-[15px] font-semibold leading-snug">{opportunity.title}</h4>
      {opportunity.why && <p className="mt-1.5 text-[13.5px] leading-relaxed">{opportunity.why}</p>}
      {opportunity.evidence.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {opportunity.evidence.map((e) => (
            <li key={e.url}>
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <span className="truncate">{e.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {view.canEdit && (
        <>
          {picking && (
            <div className="ds-enter mt-4 flex flex-wrap gap-2">
              {OPPORTUNITY_FORMATS.map((f) => (
                <Chip key={f} active={format === f} onClick={() => setFormat(f)}>
                  {FORMAT_LABEL[f]}
                </Chip>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {visibility ? (
              <button
                type="button"
                onClick={() => handlers.open("visibility")}
                className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]")}
              >
                Open AI Visibility
              </button>
            ) : (
              <button
                type="button"
                disabled={handlers.busy}
                onClick={() =>
                  handlers.opportunity({
                    opportunityId: opportunity.id,
                    decision: "create",
                    format,
                  })
                }
                className={cn(dsPrimaryBtn, "h-10 px-5 text-[13.5px]")}
              >
                Create {FORMAT_LABEL[format].toLowerCase()}
              </button>
            )}
            {!picking && !visibility && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
              >
                Something else
              </button>
            )}
            <button
              type="button"
              disabled={handlers.busy}
              onClick={() =>
                handlers.opportunity({ opportunityId: opportunity.id, decision: "dismiss" })
              }
              className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
            >
              Not for us
            </button>
          </div>
        </>
      )}
    </Tile>
  );
}

function Ideas({ view, handlers }: { view: AutopilotView; handlers: AutopilotHandlers }) {
  return (
    <SurfacePage title="Ideas" width="narrow">
      {view.opportunities.length ? (
        <div className="space-y-3">
          {view.opportunities.map((o, i) => (
            <motion.div key={o.id} {...rise(i)}>
              <OpportunityCard opportunity={o} view={view} handlers={handlers} />
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Lightbulb}
          title="Nothing new right now"
          description="Mellox watches your market and competitors and only shows what fits your brand."
        />
      )}
    </SurfacePage>
  );
}

/* ───────────────────────── activity ───────────────────────── */

function Activity({ view, handlers }: { view: AutopilotView; handlers: AutopilotHandlers }) {
  return (
    <SurfacePage title="Activity" width="narrow">
      {view.failed.length > 0 && (
        <>
          <GroupLabel>Needs a look</GroupLabel>
          <Tile className="py-1 sm:py-1">
            <ul className="divide-y divide-border/50">
              {view.failed.map((a) => (
                <ActionLine
                  key={a.id}
                  action={a}
                  right={
                    a.status === "failed" && view.canEdit ? (
                      <button
                        type="button"
                        disabled={handlers.busy}
                        onClick={() => handlers.retry(a.id)}
                        className={cn(dsGhostBtn, "h-8 shrink-0 px-3 text-[12.5px]")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    ) : (
                      <StatusPill status={a.status} />
                    )
                  }
                />
              ))}
            </ul>
          </Tile>
        </>
      )}
      {view.finished.length > 0 && (
        <>
          <GroupLabel>Posted</GroupLabel>
          <Tile className="py-1 sm:py-1">
            <ul className="divide-y divide-border/50">
              {view.finished.slice(0, 8).map((a) => (
                <ActionLine
                  key={a.id}
                  action={a}
                  right={
                    a.metrics?.views ? (
                      <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                        {a.metrics.views.toLocaleString()} views
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </Tile>
        </>
      )}
      <GroupLabel>History</GroupLabel>
      {view.events.length ? (
        <Tile>
          <Timeline events={view.events} />
        </Tile>
      ) : (
        <EmptyState icon={History} size="sm" title="No history yet" />
      )}
    </SurfacePage>
  );
}

/* ───────────────────────── settings ───────────────────────── */

function SettingsPage({ view, handlers }: { view: AutopilotView; handlers: AutopilotHandlers }) {
  const program = view.program!;
  const [s, setS] = useState<ProgramSettings>(() => settingsFromProgram(program));
  const [confirming, setConfirming] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(settingsFromProgram(program));

  return (
    <SurfacePage
      title="Settings"
      width="narrow"
      actions={
        <button
          type="button"
          disabled={handlers.busy || !dirty || !settingsValid(s)}
          onClick={() => handlers.update(s)}
          className={cn(dsPrimaryBtn, "h-9 px-5 text-[13px]")}
        >
          Save
        </button>
      }
    >
      <Readiness items={view.readiness} onOpen={handlers.open} />
      <div className="mt-3">
        <SettingRows
          s={s}
          onChange={setS}
          connected={view.connectedPlatforms}
          fullAvailable={view.fullAvailable}
        />
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        Changes apply from the next weekly plan.
      </p>

      <GroupLabel>Stop</GroupLabel>
      <Tile className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[13.5px] text-muted-foreground">
          Drafts stay. Posts already scheduled still go out.
        </p>
        {confirming ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={handlers.busy}
              onClick={handlers.stop}
              className={cn(
                dsGhostBtn,
                "h-9 border-destructive/40 px-4 text-[13px] text-destructive",
              )}
            >
              Yes, stop
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
          >
            Stop Autopilot
          </button>
        )}
      </Tile>
    </SurfacePage>
  );
}
