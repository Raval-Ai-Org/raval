"use client";

// Audience — everything a person sees, drawn from one view object and a set of
// handlers. It holds no data of its own, so the real panel and the dev-only
// lab page render exactly the same screen.
import { useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";
import { Pencil, Plus, RefreshCw, Trash2, Users, X } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import {
  MAX_TRAITS,
  MAX_TWINS,
  TRAIT_KINDS,
  type AccuracyView,
  type AudienceView,
  type PredictionView,
  type TraitKind,
  type TwinInput,
  type TwinView,
} from "@/lib/audience/contracts";
import { KIND_LABEL } from "@/lib/audience/twins";
import { duration, ease } from "@/lib/motion";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { PredictionDetail, RunProgress, runIsActive, ScoreChip, SourceTag } from "./audience-ui";

export type AudienceHandlers = {
  build: () => void;
  saveGroup: (id: string | null, group: TwinInput) => void;
  removeGroup: (id: string) => void;
  cancelBuild: (runId: string) => void;
  openBrandDna: () => void;
  busy: boolean;
};

const rise = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: duration.medium, ease: ease.standard, delay: Math.min(i, 6) * 0.05 },
});

const platformLabel = (platform: string) => PLATFORMS[platform as PlatformId]?.label ?? platform;

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function AudienceScreen({
  view,
  handlers,
}: {
  view: AudienceView;
  handlers: AudienceHandlers;
}) {
  // "new" opens an empty editor; a group id opens that group's.
  const [editing, setEditing] = useState<string | null>(null);
  const building = runIsActive(view.building) ? view.building : null;
  const failed = view.building?.status === "failed" ? view.building : null;
  const canAdd = view.canEdit && view.twins.length < MAX_TWINS;

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-full overflow-y-auto scrollbar-thin">
        <SurfacePage width="narrow">
          <motion.div {...rise(0)}>
            <Tile>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[22px] font-semibold leading-tight tracking-tight">
                    Your audience
                  </p>
                  <p className="mt-1.5 text-[13.5px] text-muted-foreground">
                    {view.twins.length
                      ? "Mellox writes for these people and checks your posts against them."
                      : "Tell Mellox who you're talking to. It will write and check posts for them."}
                  </p>
                </div>
                {view.canEdit && view.canBuild && !building && (
                  <button
                    type="button"
                    disabled={handlers.busy}
                    onClick={handlers.build}
                    className={cn(
                      view.twins.length ? dsGhostBtn : dsPrimaryBtn,
                      "h-10 px-5 text-[13.5px]",
                    )}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {view.twins.length ? "Refresh from Brand DNA" : "Build from Brand DNA"}
                  </button>
                )}
              </div>
              {building && (
                <div className="mt-4">
                  <RunProgress
                    run={building}
                    onCancel={view.canEdit ? () => handlers.cancelBuild(building.id) : undefined}
                  />
                </div>
              )}
              {failed && !building && (
                <p className="mt-3 text-[12.5px] text-destructive">{failed.error}</p>
              )}
            </Tile>
          </motion.div>

          {!view.twins.length && !building && editing !== "new" && (
            <motion.div {...rise(1)} className="mt-3">
              <Tile>
                <EmptyState
                  size="sm"
                  icon={Users}
                  title="No audience groups yet"
                  description={
                    view.canBuild
                      ? "Build them from your Brand DNA, or add one yourself."
                      : "Add who your customers are in Brand DNA, or add a group here."
                  }
                  action={
                    view.canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing("new")}
                        className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                      >
                        <Plus className="h-4 w-4" />
                        Add a group
                      </button>
                    ) : undefined
                  }
                  secondaryAction={
                    !view.canBuild ? (
                      <button
                        type="button"
                        onClick={handlers.openBrandDna}
                        className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                      >
                        Open Brand DNA
                      </button>
                    ) : undefined
                  }
                />
              </Tile>
            </motion.div>
          )}

          {(view.twins.length > 0 || editing === "new") && (
            <>
              <GroupLabel
                action={
                  canAdd && editing !== "new" ? (
                    <button
                      type="button"
                      onClick={() => setEditing("new")}
                      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add a group
                    </button>
                  ) : undefined
                }
              >
                Groups
              </GroupLabel>
              <ul className="space-y-3">
                {editing === "new" && (
                  <li>
                    <GroupEditor
                      busy={handlers.busy}
                      onCancel={() => setEditing(null)}
                      onSave={(group) => {
                        handlers.saveGroup(null, group);
                        setEditing(null);
                      }}
                    />
                  </li>
                )}
                {view.twins.map((twin, i) => (
                  <motion.li key={twin.id} {...rise(i + 1)}>
                    {editing === twin.id ? (
                      <GroupEditor
                        twin={twin}
                        busy={handlers.busy}
                        onCancel={() => setEditing(null)}
                        onSave={(group) => {
                          handlers.saveGroup(twin.id, group);
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <GroupCard
                        twin={twin}
                        canEdit={view.canEdit}
                        busy={handlers.busy}
                        onEdit={() => setEditing(twin.id)}
                        onRemove={() => handlers.removeGroup(twin.id)}
                      />
                    )}
                  </motion.li>
                ))}
              </ul>
            </>
          )}

          {view.overall && (
            <>
              <GroupLabel>What your results show</GroupLabel>
              <Tile>
                <ul className="space-y-2">
                  {view.overall.traits.map((trait) => (
                    <li key={trait.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                      <span className="min-w-0 flex-1">{trait.text}</span>
                      <SourceTag source={trait.source} />
                    </li>
                  ))}
                </ul>
              </Tile>
            </>
          )}

          <Accuracy accuracy={view.accuracy} />
          <Recent recent={view.recent} />
        </SurfacePage>
      </div>
    </MotionConfig>
  );
}

/* ───────────────────────── a group ───────────────────────── */

function GroupCard({
  twin,
  canEdit,
  busy,
  onEdit,
  onRemove,
}: {
  twin: TwinView;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const kinds = TRAIT_KINDS.filter((kind) => twin.traits.some((t) => t.kind === kind));
  const guesses = twin.traits.filter((t) => t.source === "assumed").length;
  return (
    <Tile>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold leading-tight">{twin.name}</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {[twin.segment, `about ${twin.weight}% of your audience`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onEdit}
              className={dsIconBtn}
              aria-label={`Edit ${twin.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={dsIconBtn}
              aria-label={`Remove ${twin.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {twin.summary && <p className="mt-2.5 text-[13.5px] leading-snug">{twin.summary}</p>}

      {kinds.length > 0 && (
        <dl className="mt-3.5 space-y-2.5">
          {kinds.map((kind) => (
            <div key={kind}>
              <dt className="ds-label mb-1">{KIND_LABEL[kind]}</dt>
              <dd>
                <ul className="space-y-1">
                  {twin.traits
                    .filter((t) => t.kind === kind)
                    .map((trait) => (
                      <li
                        key={trait.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]"
                      >
                        <span className="min-w-0 flex-1 leading-snug">{trait.text}</span>
                        <SourceTag source={trait.source} />
                      </li>
                    ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {guesses > 0 && canEdit && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {guesses} {guesses === 1 ? "line is" : "lines are"} our guess. Edit anything that's wrong
          and Mellox will trust your version.
        </p>
      )}
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--ds-radius-control)] bg-[var(--ds-well-bg)] px-3 py-2">
          <p className="text-[12.5px]">Remove this group? Mellox will stop writing for it.</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
            >
              Keep
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onRemove();
              }}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px] text-destructive")}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </Tile>
  );
}

type Row = { id?: string; kind: TraitKind; text: string };

function GroupEditor({
  twin,
  busy,
  onSave,
  onCancel,
}: {
  twin?: TwinView;
  busy: boolean;
  onSave: (group: TwinInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(twin?.name ?? "");
  const [segment, setSegment] = useState(twin?.segment ?? "");
  const [summary, setSummary] = useState(twin?.summary ?? "");
  const [weight, setWeight] = useState(twin?.weight ?? 50);
  const [rows, setRows] = useState<Row[]>(
    // What was measured from real posts is not edited by hand.
    twin?.traits
      .filter((t) => t.source !== "measured")
      .map((t) => ({ id: t.id, kind: t.kind, text: t.text })) ?? [
      { kind: "goal", text: "" },
      { kind: "pain", text: "" },
    ],
  );
  const set = (i: number, patch: Partial<Row>) =>
    setRows((list) => list.map((row, at) => (at === i ? { ...row, ...patch } : row)));
  const valid = name.trim().length > 0;
  const field = "h-10 rounded-[var(--ds-radius-control)] text-[13.5px]";

  return (
    <Tile>
      <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
        <label className="block">
          <span className="ds-label mb-1 block">Name</span>
          <Input
            value={name}
            maxLength={80}
            autoFocus
            placeholder="Busy salon owners"
            onChange={(e) => setName(e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          <span className="ds-label mb-1 block">Share of audience</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={100}
              value={weight}
              onChange={(e) => setWeight(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className={field}
            />
            <span className="text-[13px] text-muted-foreground">%</span>
          </div>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="ds-label mb-1 block">Who they are</span>
        <Input
          value={segment}
          maxLength={120}
          placeholder="Owner of a small salon, does the marketing herself"
          onChange={(e) => setSegment(e.target.value)}
          className={field}
        />
      </label>
      <label className="mt-3 block">
        <span className="ds-label mb-1 block">In a sentence or two</span>
        <Textarea
          value={summary}
          maxLength={600}
          rows={2}
          onChange={(e) => setSummary(e.target.value)}
          className="rounded-[var(--ds-radius-control)] text-[13.5px]"
        />
      </label>

      <p className="ds-label mb-1.5 mt-4">What's true about them</p>
      <ul className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select
              value={row.kind}
              aria-label="What kind of statement"
              onChange={(e) => set(i, { kind: e.target.value as TraitKind })}
              className="h-10 w-[150px] shrink-0 rounded-[var(--ds-radius-control)] border border-input bg-background px-2 text-[12.5px]"
            >
              {TRAIT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </select>
            <Input
              value={row.text}
              maxLength={280}
              aria-label={KIND_LABEL[row.kind]}
              onChange={(e) => set(i, { text: e.target.value })}
              className={cn(field, "min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={() => setRows((list) => list.filter((_, at) => at !== i))}
              className={dsIconBtn}
              aria-label="Remove this line"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {rows.length < MAX_TRAITS && (
        <button
          type="button"
          onClick={() => setRows((list) => [...list, { kind: "goal", text: "" }])}
          className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a line
        </button>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() =>
            onSave({
              name: name.trim(),
              segment: segment.trim(),
              summary: summary.trim(),
              weight,
              traits: rows
                .map((row) => ({ ...row, text: row.text.trim() }))
                .filter((row) => row.text.length > 0),
            })
          }
          className={cn(dsPrimaryBtn, "h-9 px-5 text-[13px]")}
        >
          Save
        </button>
      </div>
    </Tile>
  );
}

/* ───────────────────────── predicted vs real ───────────────────────── */

export function Accuracy({ accuracy }: { accuracy: AccuracyView }) {
  return (
    <>
      <GroupLabel>How close the scores were</GroupLabel>
      <Tile>
        {accuracy.measured === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing to compare yet. A week after a scored post goes out, its real result shows up
            here and Mellox starts correcting itself.
          </p>
        ) : (
          <>
            <p className="text-[14px]">
              <span className="font-semibold tabular-nums">{accuracy.measured}</span>{" "}
              {accuracy.measured === 1 ? "post" : "posts"} measured
              {accuracy.averageGap !== null && accuracy.compared > 0 ? (
                <>
                  {" · "}scores were off by{" "}
                  <span className="font-semibold tabular-nums">{accuracy.averageGap}</span> points
                  on average
                </>
              ) : (
                " · not enough yet to say how close the scores were"
              )}
            </p>
            {accuracy.learned.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {accuracy.learned.map((line) => (
                  <li key={line} className="text-[13px] text-muted-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 divide-y divide-border/50">
              {accuracy.outcomes.map((outcome) => (
                <li key={outcome.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{outcome.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {[platformLabel(outcome.platform), `${outcome.views.toLocaleString()} views`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">Expected</span>
                  <ScoreChip overall={outcome.predicted} title="What Mellox expected" />
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">Real</span>
                  {outcome.actual === null ? (
                    <span
                      className="inline-flex h-6 items-center rounded-full bg-[var(--ds-well-bg)] px-2 text-[11.5px] text-muted-foreground"
                      title="Needs more of your posts to compare with"
                    >
                      Soon
                    </span>
                  ) : (
                    <ScoreChip
                      overall={outcome.actual}
                      title="Where this post landed among your own posts"
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Tile>
    </>
  );
}

function Recent({ recent }: { recent: PredictionView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!recent.length) return null;
  return (
    <>
      <GroupLabel>Recently checked</GroupLabel>
      <Tile className="!py-1.5">
        <ul className="divide-y divide-border/50">
          {recent.map((prediction) => {
            const expanded = open === prediction.id;
            return (
              <li key={prediction.id} className="py-2.5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : prediction.id)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{prediction.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {[
                        platformLabel(prediction.platform),
                        prediction.depth === "pulse" ? "Audience check" : "Quick score",
                        timeAgo(prediction.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <ScoreChip overall={prediction.overall} />
                </button>
                {expanded && (
                  <div className="mt-3 pb-1">
                    <PredictionDetail prediction={prediction} compact />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Tile>
    </>
  );
}
