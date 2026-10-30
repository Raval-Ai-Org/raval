"use client";

// One campaign: its goal (the person's own count, never an estimate), its
// phases with every post and Story where it is now, and the controls to start,
// pause or end it. Starting is a person's click; nothing here spends by itself.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Spinner,
  Stop,
  Trash,
  X,
} from "@/components/icons";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignView, PieceView } from "@/lib/campaigns/contracts";
import { goalLine, isShareableLink, linkRule } from "@/lib/campaigns/links";
import { phaseOf, playbookById } from "@/lib/campaigns/playbooks";
import { currentPhase, daysUntil } from "@/lib/campaigns/progress";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  ChannelMark,
  FormatChip,
  PhaseRail,
  StatePill,
  StatusPill,
  countdown,
  kindIcon,
  shortDate,
} from "./kit";
import type { CampaignsHandlers, CampaignsView, PiecePatch } from "./types";

export function CampaignDetail({
  view,
  id,
  handlers,
}: {
  view: CampaignsView;
  id: string;
  handlers: CampaignsHandlers;
}) {
  const c =
    view.selected?.id === id
      ? view.selected
      : (view.home.campaigns.find((x) => x.id === id) ?? null);
  if (!c) {
    return (
      <div className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-8 @3xl/campaigns:px-8">
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="h-40 w-full rounded-[20px]" />
        <Skeleton className="h-64 w-full rounded-[20px]" />
      </div>
    );
  }
  return <Detail c={c} view={view} handlers={handlers} />;
}

function Detail({
  c,
  view,
  handlers,
}: {
  c: CampaignView;
  view: CampaignsView;
  handlers: CampaignsHandlers;
}) {
  const playbook = playbookById(c.type);
  const Icon = kindIcon(playbook?.icon);
  const busy = view.busy;
  const live = c.status === "running" || c.status === "paused";
  const over = c.status === "done" || c.status === "ended";
  const planning = busy === `plan:${c.id}`;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const phase = currentPhase(c.plan.phases, view.today);
  const key = c.keyDate ? daysUntil(c.keyDate, view.today) : null;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pb-16 @3xl/campaigns:px-8">
      {/* Header */}
      <div className="relative pb-6 pt-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 right-0 h-48 w-1/2 rounded-full bg-primary/10 blur-3xl"
        />
        <button
          type="button"
          onClick={() => handlers.go({ kind: "home" })}
          className="relative mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Campaigns
        </button>
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[24px] font-semibold leading-tight tracking-tight">
                {c.name}
              </h1>
              <StatusPill status={c.status} />
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {playbook?.label ?? "Campaign"} · {shortDate(c.startsOn)} – {shortDate(c.endsOn)}
              {live && phase ? ` · now: ${phase.label}` : ""}
            </p>
          </div>
          {view.canEdit && (
            <div className="flex w-full flex-wrap items-center gap-2 @2xl/campaigns:w-auto">
              <button
                type="button"
                onClick={handlers.openCalendar}
                className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
              >
                <Calendar className="size-4" />
                Calendar
              </button>
              {(c.status === "draft" || c.status === "ready") && (
                <button
                  type="button"
                  aria-label="Edit"
                  title="Edit"
                  onClick={() => handlers.go({ kind: "new", type: c.type, editId: c.id })}
                  className={cn(dsGhostBtn, "h-9 w-9 p-0")}
                >
                  <Pencil className="size-4" />
                </button>
              )}
              {live && (
                <button
                  type="button"
                  disabled={!!busy}
                  data-testid="pause-campaign"
                  onClick={() => handlers.pause(c.id, c.status === "running")}
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                >
                  {c.status === "running" ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {c.status === "running" ? "Pause" : "Resume"}
                </button>
              )}
              {live &&
                (confirmEnd ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 p-1 pl-3 text-[12.5px]">
                    End it? Unmade posts are dropped.
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmEnd(false);
                        handlers.end(c.id);
                      }}
                      className="h-7 rounded-full bg-destructive px-3 font-medium text-destructive-foreground"
                    >
                      End
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel"
                      onClick={() => setConfirmEnd(false)}
                      className={dsIconBtn}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => setConfirmEnd(true)}
                    className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                  >
                    <Stop className="size-4" />
                    End
                  </button>
                ))}
              {c.status === "draft" && (
                <button
                  type="button"
                  disabled={!!busy}
                  data-testid="plan-campaign"
                  onClick={() => void handlers.plan(c.id)}
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                >
                  {planning ? (
                    <Spinner className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {planning ? "Writing…" : "Write the plan"}
                  {!planning && (
                    <span
                      data-slot="cost-chip"
                      className="rounded-full px-1.5 py-0.5 text-[11px] tabular-nums"
                    >
                      {view.home.price.plan} credits
                    </span>
                  )}
                </button>
              )}
              {c.status === "ready" && (
                <button
                  type="button"
                  disabled={!!busy}
                  data-testid="start-campaign"
                  onClick={() => handlers.start(c.id)}
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                >
                  {busy === `start:${c.id}` ? (
                    <Spinner className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Start campaign
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Goal and progress */}
      <div className="grid gap-3 @3xl/campaigns:grid-cols-[1.3fr_1fr]">
        <GoalBox c={c} canEdit={view.canEdit} onCount={(n) => handlers.count(c.id, n)} />
        <div className="ds-tile flex flex-col justify-between gap-4 p-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Out" value={`${c.progress.out}/${c.progress.pieces}`} />
            <Stat
              label="Waiting for you"
              value={String(c.progress.waiting)}
              accent={c.progress.waiting > 0}
            />
            <Stat
              label="Views"
              value={c.progress.measured ? (c.progress.views ?? 0).toLocaleString("en-US") : "—"}
              hint={c.progress.measured ? undefined : "Not measured yet"}
            />
          </div>
          <div>
            <PhaseRail phases={c.plan.phases} today={view.today} />
            {key !== null && !over && (
              <p className="mt-3 text-[12px] text-muted-foreground">
                Big day <span className="font-medium text-foreground">{shortDate(c.keyDate!)}</span>{" "}
                · {countdown(key).toLowerCase()}
              </p>
            )}
          </div>
        </div>
      </div>

      {c.plan.bigIdea && (
        <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-foreground/85">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
            The idea
          </span>
          {c.plan.bigIdea}
        </p>
      )}

      {c.status === "draft" && !c.plan.written && (
        <div className="ds-tile mt-6 flex flex-wrap items-center gap-3 p-4">
          <Sparkles className="size-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
            The dates and formats are set. Write the plan and Mellox fills in what each post says,
            from your brief and Brand DNA.
          </p>
        </div>
      )}

      {/* Phases */}
      <div className="mt-8 space-y-8">
        {c.plan.phases.map((ph, i) => {
          const pieces = c.pieces.filter((p) => p.phase === ph.id);
          const feed = pieces.filter((p) => p.format !== "story");
          const stories = pieces.filter((p) => p.format === "story");
          const now = ph.startsOn <= view.today && view.today <= ph.endsOn;
          const cta = playbook ? phaseOf(playbook, ph.id).cta : "none";
          return (
            <div key={ph.id} className="ds-enter">
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[11px] font-bold",
                    now
                      ? "bg-primary text-primary-foreground"
                      : "bg-[var(--ds-well-bg)] text-foreground/70",
                  )}
                >
                  {i + 1}
                </span>
                <h2 className="text-[15px] font-semibold tracking-tight">{ph.label}</h2>
                <span className="text-[12px] text-muted-foreground">
                  {ph.startsOn === ph.endsOn
                    ? shortDate(ph.startsOn)
                    : `${shortDate(ph.startsOn)} – ${shortDate(ph.endsOn)}`}
                </span>
                {now && live && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10.5px] font-semibold">
                    Now
                  </span>
                )}
              </div>
              {ph.purpose && (
                <p className="mb-3 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
                  {ph.purpose}
                </p>
              )}
              <div className="grid gap-3 @xl/campaigns:grid-cols-2 @4xl/campaigns:grid-cols-3">
                {feed.map((p) => (
                  <PieceCard
                    key={p.id}
                    piece={p}
                    c={c}
                    cta={cta}
                    mediaUrls={view.mediaUrls}
                    canEdit={view.canEdit && !over}
                    onOpen={handlers.openPiece}
                    onEdit={(patch) => handlers.editPiece(c.id, p.id, patch)}
                  />
                ))}
              </div>
              {stories.length > 0 && (
                <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="shrink-0 text-[11.5px] font-medium text-muted-foreground">
                    Stories
                  </span>
                  {stories.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!s.contentIds[0]}
                      onClick={() => s.contentIds[0] && handlers.openPiece(s.contentIds[0])}
                      className="relative flex h-[72px] w-[44px] shrink-0 flex-col items-center justify-end overflow-hidden rounded-xl bg-[var(--ds-well-bg)] p-1 ring-1 ring-border/60 transition-transform enabled:hover:-translate-y-0.5"
                      title={`${shortDate(s.date)} ${s.time} · ${s.title || "Story"}`}
                    >
                      {s.thumb && (
                        <img
                          src={s.thumb}
                          alt=""
                          className="absolute inset-0 size-full object-cover"
                        />
                      )}
                      <span className="relative rounded-full bg-background/85 px-1 text-[9px] font-semibold tabular-nums">
                        {shortDate(s.date).split(" ")[1]}
                      </span>
                      {(s.state === "out" || s.state === "waiting") && (
                        <span
                          className={cn(
                            "absolute right-1 top-1 size-2 rounded-full",
                            s.state === "out" ? "bg-foreground" : "bg-primary",
                          )}
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
              {!pieces.length && (
                <p className="text-[12px] text-muted-foreground">Nothing planned in this step.</p>
              )}
            </div>
          );
        })}
        {!c.plan.phases.length && <EmptyState icon={Megaphone} size="sm" title="No plan yet" />}
      </div>

      {view.canEdit && (c.status === "draft" || c.status === "ready") && (
        <div className="mt-12 flex justify-center">
          <button
            type="button"
            onClick={() => handlers.remove(c.id)}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-destructive"
          >
            <Trash className="size-3.5" />
            Delete this draft
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "text-[20px] font-semibold tabular-nums leading-none tracking-tight",
          accent && "text-primary",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{hint ?? label}</p>
    </div>
  );
}

function GoalBox({
  c,
  canEdit,
  onCount,
}: {
  c: CampaignView;
  canEdit: boolean;
  onCount(n: number | null): void;
}) {
  const goal = c.goal;
  const line = goalLine(goal);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const share = goal.target && goal.count !== null ? Math.min(1, goal.count / goal.target) : null;
  const link = goal.link && isShareableLink(goal.link) ? goal.link : null;
  return (
    <div className="ds-tile relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium text-muted-foreground">{line.label}</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums leading-none tracking-tight">
            {line.value ??
              (goal.target ? `Goal ${goal.target.toLocaleString("en-US")}` : "Your count")}
          </p>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {goal.count !== null && goal.countAt
              ? `You entered it ${new Date(goal.countAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
              : "Mellox can't see this number. Add it as it comes in."}
          </p>
        </div>
        {canEdit && draft === null && (
          <button
            type="button"
            data-testid="edit-count"
            onClick={() => setDraft(goal.count === null ? "" : String(goal.count))}
            className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          >
            <Pencil className="size-3.5" />
            {goal.count === null ? "Add count" : "Update"}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {draft !== null && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease: ease.standard }}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              const n = draft.trim() === "" ? null : Math.max(0, Math.floor(Number(draft)));
              if (n === null || Number.isFinite(n)) onCount(n);
              setDraft(null);
            }}
          >
            <div className="mt-3 flex items-center gap-2">
              <input
                autoFocus
                type="number"
                min={0}
                inputMode="numeric"
                aria-label="Your count"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-9 w-32 rounded-full border border-border/70 bg-[var(--ds-tile-bg)] px-3.5 text-[13px] tabular-nums outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
              />
              <button type="submit" className={cn(dsPrimaryBtn, "h-9 px-3.5 text-[12.5px]")}>
                <Check className="size-4" />
                Save
              </button>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => setDraft(null)}
                className={dsIconBtn}
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      {share !== null && (
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${share * 100}%` }}
            transition={{ duration: duration.xslow * 2, ease: ease.emphasized }}
          />
        </div>
      )}
      {link && (
        <div className="mt-4 flex items-center gap-2 rounded-full bg-[var(--ds-well-bg)] p-1 pl-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
            {link.replace(/^https:\/\//, "")}
          </span>
          <button
            type="button"
            aria-label="Copy link"
            title="Copy link"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              });
            }}
            className={dsIconBtn}
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open link"
            className={dsIconBtn}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}

function PieceCard({
  piece,
  c,
  cta,
  mediaUrls,
  canEdit,
  onOpen,
  onEdit,
}: {
  piece: PieceView;
  c: CampaignView;
  cta: "none" | "soft" | "link";
  mediaUrls: Record<string, string>;
  canEdit: boolean;
  onOpen(contentId: string): void;
  onEdit(patch: PiecePatch): void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ date: piece.date, time: piece.time, idea: piece.idea });
  const editable = canEdit && (piece.state === "idea" || piece.state === "planned");
  const contentId = piece.contentIds[0];
  const thumb = piece.thumb ?? piece.mediaIds.map((id) => mediaUrls[id]).find(Boolean) ?? null;
  const link = linkRule(piece.platform, c.goal, cta).mode;

  return (
    <div
      data-testid="piece-card"
      className={cn(
        "ds-tile group flex flex-col overflow-hidden p-0",
        piece.state === "cancelled" && "opacity-55",
      )}
    >
      <button
        type="button"
        disabled={!contentId}
        onClick={() => contentId && onOpen(contentId)}
        className="relative block aspect-[16/9] w-full overflow-hidden bg-[var(--ds-well-bg)] text-left enabled:cursor-pointer"
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className={cn(
              "size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]",
              !piece.thumb && "opacity-80 saturate-[0.85]",
            )}
          />
        ) : piece.state === "making" ? (
          <div className="studio-weave size-full" />
        ) : (
          <div className="grid size-full place-items-center">
            <ChannelMark platform={piece.platform} size={36} className="opacity-70" />
          </div>
        )}
        <span className="absolute left-2 top-2 flex items-center gap-1">
          <ChannelMark platform={piece.platform} size={22} className="shadow-sm" />
          <FormatChip format={piece.format} className="bg-background/90 shadow-sm backdrop-blur" />
        </span>
        <StatePill state={piece.state} className="absolute right-2 top-2" />
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="text-[11.5px] font-medium tabular-nums text-muted-foreground">
          {shortDate(piece.date)} · {piece.time}
          {link === "caption" && <span className="ml-1.5 text-primary">· link in caption</span>}
          {link === "bio" && <span className="ml-1.5">· link in bio</span>}
        </p>
        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const patch: PiecePatch = {};
              if (form.date !== piece.date) patch.date = form.date;
              if (form.time !== piece.time) patch.time = form.time;
              if (form.idea.trim() !== piece.idea) patch.idea = form.idea.trim();
              if (Object.keys(patch).length) onEdit(patch);
              setEditing(false);
            }}
          >
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="Day"
                value={form.date}
                min={c.startsOn}
                max={c.endsOn}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value || f.date }))}
                className="h-8 min-w-0 flex-1 rounded-xl border border-border/70 bg-transparent px-2 text-[12px]"
              />
              <input
                type="time"
                aria-label="Time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value || f.time }))}
                className="h-8 w-24 rounded-xl border border-border/70 bg-transparent px-2 text-[12px]"
              />
            </div>
            <textarea
              aria-label="Idea"
              value={form.idea}
              maxLength={700}
              onChange={(e) => setForm((f) => ({ ...f, idea: e.target.value }))}
              className="min-h-[72px] w-full resize-y rounded-xl border border-border/70 bg-transparent px-2.5 py-2 text-[12.5px] leading-relaxed outline-none focus:border-primary/50"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
              >
                Cancel
              </button>
              <button type="submit" className={cn(dsPrimaryBtn, "h-8 px-3 text-[12px]")}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug">
              {piece.title || (c.plan.written ? "Untitled post" : "Idea comes with the plan")}
            </p>
            {piece.idea && (
              <p className="line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
                {piece.idea}
              </p>
            )}
            {piece.error && piece.state === "failed" && (
              <p className="text-[12px] text-destructive">{piece.error}</p>
            )}
          </>
        )}
        {!editing && (editable || contentId) && (
          <div className="mt-auto flex items-center gap-1 pt-1">
            {contentId && (
              <button
                type="button"
                onClick={() => onOpen(contentId)}
                className={cn(dsGhostBtn, "h-7 px-2.5 text-[11.5px]")}
              >
                {piece.state === "waiting" ? "Review" : "Open"}
              </button>
            )}
            {editable && (
              <button
                type="button"
                aria-label="Edit post"
                onClick={() => setEditing(true)}
                className={cn(dsIconBtn, "ml-auto size-7")}
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
