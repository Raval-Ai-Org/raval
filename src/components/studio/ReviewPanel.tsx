"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Maximize2 } from "lucide-react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DeliveryView } from "@/components/app/DeliveryView";
import { StudioDestinationPicker } from "@/components/app/StudioDestinationPicker";
import { supabase } from "@/integrations/supabase/client";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { updateContentItem } from "@/lib/content.functions";
import { publishContentItems, scheduleContentItems } from "@/lib/sdr.functions";
import type { PublishSelection } from "@/lib/sdr.handlers";
import { canDistribute, useSdrStatus } from "@/hooks/use-sdr-status";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { RATIOS } from "@/lib/studio/aspect";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import {
  isActiveJob,
  REFINE_PRESETS,
  type StudioJob,
  type StudioJobOutput,
} from "@/lib/studio/jobs";
import { scriptToMarkdown } from "@/lib/studio/prompts";
import {
  cancelSession,
  discardSession,
  generate,
  openComposer,
  patchJobOutput,
  type StudioSession,
} from "@/lib/studio/session-store";
import { AdPreview } from "./previews/AdPreview";
import { ArticlePreview } from "./previews/ArticlePreview";
import { usePreviewBrand } from "./previews/brand";
import { CarouselPreview } from "./previews/CarouselPreview";
import { MediaFrame } from "./previews/MediaFrame";
import { ScriptPreview } from "./previews/ScriptPreview";
import { SocialPostPreview } from "./previews/SocialPostPreview";

export type ReviewRow = {
  id: string;
  status: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  scheduled_at: string | null;
};

const SDR_DELIVERABLE: PlatformId[] = ["linkedin", "twitter", "facebook", "instagram"];
const SHIPPABLE_TYPES = ["social", "image", "video", "carousel"];

const STATUS_COPY: Record<string, { label: string; tone: "warn" | "ok" | "muted" | "danger" }> = {
  draft: { label: "Draft", tone: "muted" },
  pending: { label: "Needs approval", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  scheduled: { label: "Scheduled", tone: "ok" },
  publishing: { label: "Publishing", tone: "ok" },
  published: { label: "Published", tone: "ok" },
  rejected: { label: "Discarded", tone: "muted" },
  failed: { label: "Failed", tone: "danger" },
  partial_failed: { label: "Partly published", tone: "danger" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_COPY[status] ?? { label: status, tone: "muted" as const };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
        s.tone === "warn" && "bg-warning-surface text-warning ring-warning-border",
        s.tone === "ok" && "bg-success-surface text-success ring-success-border",
        s.tone === "danger" && "bg-danger-surface text-danger ring-danger-border",
        s.tone === "muted" && "bg-surface-2 text-muted-foreground ring-border",
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

function defaultScheduleTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function InspectorSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-no-rhythm
      className={cn("border-b border-border px-5 py-4 last:border-b-0", className)}
    >
      <h3 className="ui-eyebrow mb-3 flex">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Review: the result rendered as it will ship on the left; on the right, an
 * inspector that always makes the next step obvious — approve, then schedule or
 * publish — with one-click improvements that revise without starting over.
 */
export function ReviewPanel({
  session,
  fixtureRows,
  fixtureDistribution,
}: {
  session: StudioSession;
  /** Preview/testing: content rows to use instead of querying Supabase. */
  fixtureRows?: ReviewRow[];
  fixtureDistribution?: boolean;
}) {
  const job = (session.lastGood ?? session.job) as StudioJob;
  const format = STUDIO_FORMATS[session.type];
  const brand = usePreviewBrand(session.workspaceId);
  const revising = !!session.pendingKey || !!(session.job && isActiveJob(session.job));
  const sdr = useSdrStatus(fixtureRows ? null : session.workspaceId);
  const distributionReady = fixtureDistribution ?? canDistribute(sdr);

  const [rows, setRows] = useState<ReviewRow[]>(fixtureRows ?? []);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StudioJobOutput>(job.output);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "approve" | "schedule" | "publish" | "discard">(
    null,
  );
  const [active, setActive] = useState<PlatformId | null>(null);
  const [scope, setScope] = useState<"one" | "all">("all");
  const [custom, setCustom] = useState("");
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleTime);
  const [selection, setSelection] = useState<PublishSelection>({ type: "all" });
  const [expanded, setExpanded] = useState(false);
  const [justApproved, setJustApproved] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(job.output);
  }, [job.output, dirty]);

  const loadRows = useCallback(async () => {
    if (fixtureRows) return;
    if (!job.content_item_ids?.length) return setRows([]);
    const { data } = await supabase
      .from("content_items")
      .select("id, status, title, body, meta, scheduled_at")
      .in("id", job.content_item_ids);
    setRows(
      ((data ?? []) as ReviewRow[]).sort(
        (a, b) => job.content_item_ids.indexOf(a.id) - job.content_item_ids.indexOf(b.id),
      ),
    );
  }, [job.content_item_ids, fixtureRows]);

  useEffect(() => {
    void loadRows();
    const on = () => void loadRows();
    addAppEventListener("content:changed", on);
    return () => removeAppEventListener("content:changed", on);
  }, [loadRows]);

  const platforms: PlatformId[] = useMemo(() => {
    const fromVariants = draft.variants?.map((v) => v.platform) ?? [];
    if (fromVariants.length) return fromVariants;
    return rows
      .map((r) => r.meta?.platform)
      .filter((p): p is PlatformId => typeof p === "string" && p in PLATFORMS);
  }, [draft.variants, rows]);
  const current = active && platforms.includes(active) ? active : (platforms[0] ?? null);
  const media = draft.media?.find((m) => m.slot === "main") ?? draft.media?.[0] ?? null;
  const ratio = media?.ratio ?? session.controls.ratio ?? format.ratios[0] ?? "1:1";
  const statuses = new Set(rows.map((r) => r.status));
  const groupStatus = rows.length
    ? statuses.size === 1
      ? rows[0].status
      : statuses.has("pending")
        ? "pending"
        : rows[0].status
    : "pending";
  const locked = rows.some((r) =>
    ["scheduled", "publishing", "published", "partial_failed"].includes(r.status),
  );
  const approvable = rows.some((r) => r.status === "pending" || r.status === "draft");
  const deliverable = rows.filter((r) => SDR_DELIVERABLE.includes(r.meta?.platform as PlatformId));
  const shippableType = SHIPPABLE_TYPES.includes(session.type);
  const canShip = distributionReady && deliverable.length > 0 && shippableType;
  const multi = platforms.length > 1;
  const refineTarget = multi && scope === "one" && current ? current : "all";

  const edit = (next: StudioJobOutput) => {
    setDraft(next);
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setBusy("save");
    try {
      for (const row of rows) {
        const platform = row.meta?.platform as PlatformId | undefined;
        const patch: Record<string, unknown> = {};
        if (session.type === "article" && draft.article) {
          Object.assign(patch, {
            title: draft.article.title,
            body: draft.article.markdown,
            meta: {
              article: {
                dek: draft.article.dek,
                metaDescription: draft.article.metaDescription,
                takeaways: draft.article.takeaways,
                wordCount: draft.article.markdown.split(/\s+/).filter(Boolean).length,
              },
            },
          });
        } else if (session.type === "script" && draft.script) {
          Object.assign(patch, {
            body: `${scriptToMarkdown(draft.script)}\n\n---\n\n${draft.script.caption}`,
            meta: { script: draft.script },
          });
        } else {
          const v = draft.variants?.find((x) => x.platform === platform);
          if (v) patch.body = v.body;
          if (session.type === "carousel") patch.meta = { slides: draft.slides ?? [] };
          if (session.type === "ad") patch.meta = { ad_variants: draft.ads ?? [] };
        }
        if (Object.keys(patch).length && !fixtureRows)
          await updateContentItem({ data: { id: row.id, patch: patch as never } });
      }
      patchJobOutput(
        session.id,
        draft,
        session.type === "article" ? draft.article?.title : undefined,
      );
      setDirty(false);
      setEditing(false);
      emitAppEvent("content:changed");
      toast.success("Changes saved", {
        description: approvable ? undefined : "Edited work goes back to Needs Approval.",
      });
      return true;
    } catch (e) {
      toast.error("Couldn't save your edits", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (dirty && !(await save())) return false;
    setBusy("approve");
    try {
      if (!fixtureRows) {
        await Promise.all(
          rows
            .filter((r) => r.status === "pending" || r.status === "draft")
            .map((r) => updateContentItem({ data: { id: r.id, patch: { status: "approved" } } })),
        );
      } else {
        setRows((list) => list.map((r) => ({ ...r, status: "approved" })));
      }
      emitAppEvent("content:changed");
      await loadRows();
      setJustApproved(true);
      return true;
    } catch (e) {
      toast.error("Couldn't approve", { description: e instanceof Error ? e.message : undefined });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const distribute = async (kind: "schedule" | "publish") => {
    if (approvable && !(await approve())) return;
    setBusy(kind);
    try {
      const ids = deliverable.map((r) => r.id);
      const res =
        kind === "publish"
          ? await publishContentItems(session.workspaceId, ids, selection)
          : await scheduleContentItems(
              session.workspaceId,
              ids.map((id, i) => ({
                contentItemId: id,
                scheduledAt: new Date(
                  new Date(scheduleAt).getTime() + i * 10 * 60_000,
                ).toISOString(),
              })),
              selection,
            );
      const sent = res.results.filter((r) => r.status === "publishing" || r.status === "already");
      const skipped = res.results.filter((r) => r.status === "skipped");
      if (sent.length) {
        toast.success(
          kind === "publish"
            ? `Publishing to ${sent.length} destination${sent.length === 1 ? "" : "s"}`
            : `Scheduled for ${new Date(scheduleAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
          {
            description: skipped.length
              ? `${skipped.length} skipped — ${skipped[0].reason ?? "no connected account"}`
              : undefined,
          },
        );
      } else {
        toast.error(kind === "publish" ? "Nothing was published" : "Nothing was scheduled", {
          description: skipped[0]?.reason ?? "Connect an account for these platforms.",
        });
      }
      emitAppEvent("content:changed");
      await loadRows();
    } catch (e) {
      toast.error(kind === "publish" ? "Couldn't publish" : "Couldn't schedule", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      if (!fixtureRows) {
        await Promise.all(
          rows
            .filter((r) => r.status === "pending" || r.status === "failed")
            .map((r) => updateContentItem({ data: { id: r.id, patch: { status: "rejected" } } })),
        );
      }
      emitAppEvent("content:changed");
      toast("Discarded", { description: "Removed from Needs Approval." });
      discardSession(session.id);
    } catch (e) {
      toast.error("Couldn't discard", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const refine = (instruction: string, target = refineTarget, preset?: string) => {
    if (dirty) {
      toast("Save or discard your edits first", {
        description: "Improvements build on the saved version.",
      });
      return;
    }
    void generate(session.id, { kind: "refine", refine: { instruction, target, preset } });
  };

  const copyText = () => {
    const text =
      session.type === "article"
        ? `# ${draft.article?.title}\n\n${draft.article?.markdown}`
        : session.type === "script" && draft.script
          ? `${scriptToMarkdown(draft.script)}\n\n${draft.script.caption}`
          : session.type === "ad"
            ? (draft.ads ?? [])
                .map(
                  (a, i) =>
                    `Variant ${"ABCD"[i]}\n${a.primaryText}\nHeadline: ${a.headline}\nCTA: ${a.cta}`,
                )
                .join("\n\n")
            : (draft.variants?.find((v) => v.platform === current)?.body ?? "");
    void navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Couldn't copy"),
    );
  };

  const variant = draft.variants?.find((v) => v.platform === current) ?? null;
  const retryMedia = () => refine("Render the visual again.", "media");
  const partial = (draft.partial ?? []).filter(Boolean);
  const updateVariant = (body: string) =>
    edit({
      ...draft,
      variants: draft.variants!.map((v) =>
        v.platform === variant?.platform ? { ...v, body, chars: body.length } : v,
      ),
    });

  const preview = (() => {
    switch (session.type) {
      case "article":
        return draft.article ? (
          <ArticlePreview
            article={draft.article}
            brand={brand}
            editing={editing}
            onChange={(p) => edit({ ...draft, article: { ...draft.article!, ...p } })}
          />
        ) : null;
      case "script":
        return draft.script ? (
          <ScriptPreview script={draft.script} platform={platforms[0]} />
        ) : null;
      case "carousel":
        return (
          <div className="grid w-full max-w-[1000px] items-start gap-8 2xl:grid-cols-2">
            {draft.slides?.length ? (
              <CarouselPreview
                slides={draft.slides}
                brand={brand}
                ratio={ratio}
                cover={media}
                editing={editing}
                onSlideChange={(i, slide) =>
                  edit({ ...draft, slides: draft.slides!.map((s, j) => (j === i ? slide : s)) })
                }
              />
            ) : null}
            {variant ? (
              <SocialPostPreview
                variant={variant}
                brand={brand}
                editing={editing}
                onChange={updateVariant}
              />
            ) : null}
          </div>
        );
      case "ad":
        return draft.ads?.length ? (
          <AdPreview
            ads={draft.ads}
            platform={current ?? "facebook"}
            brand={brand}
            media={media}
            ratio={ratio}
            onRetryMedia={retryMedia}
            onExpand={() => setExpanded(true)}
          />
        ) : null;
      default:
        return variant ? (
          <SocialPostPreview
            variant={variant}
            brand={brand}
            media={format.media === "none" ? null : media}
            ratio={media ? ratio : undefined}
            editing={editing}
            onRetryMedia={retryMedia}
            onExpand={() => setExpanded(true)}
            onChange={updateVariant}
          />
        ) : null;
    }
  })();

  const hasMedia = !!media && media.status !== "failed";
  const firstScheduled = rows.find((r) => r.scheduled_at)?.scheduled_at;

  /* ── Next step card ── */
  const nextStep = (() => {
    if (locked) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {groupStatus === "scheduled" && firstScheduled
              ? `Scheduled for ${new Date(firstScheduled).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`
              : groupStatus === "published"
                ? "Published. Delivery details are below."
                : "Sent to your connected accounts."}
          </p>
          {rows[0] && !fixtureRows ? (
            <DeliveryView workspaceId={session.workspaceId} contentItemId={rows[0].id} />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => openComposer({ type: session.type })}
          >
            <Plus />
            Create another {format.noun}
          </Button>
        </div>
      );
    }
    if (approvable) {
      return (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Check every {multi ? "platform version" : "detail"}, edit anything, then approve.
            Nothing goes out until you do.
          </p>
          <Button
            className="w-full"
            size="lg"
            onClick={() => void approve()}
            disabled={revising || busy !== null || editing}
          >
            <Check />
            {busy === "approve"
              ? "Approving…"
              : multi
                ? `Approve all ${platforms.length}`
                : "Approve"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => void discard()}
            disabled={revising || busy !== null}
          >
            Discard
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <AnimatePresence>
          {justApproved ? (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
              className="flex items-center gap-2 rounded-lg bg-success-surface px-3 py-2 text-sm text-success ring-1 ring-success-border"
            >
              <Check className="size-4" strokeWidth={2.5} />
              Approved{canShip ? " — ready to go out" : ""}
            </motion.div>
          ) : null}
        </AnimatePresence>
        {canShip ? (
          <>
            <div>
              <label htmlFor="studio-schedule-at" className="text-xs font-medium text-foreground">
                Schedule for
              </label>
              <input
                id="studio-schedule-at"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-input bg-surface-3 px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
              />
              {deliverable.length > 1 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Platforms go out 10 minutes apart.
                </p>
              ) : null}
            </div>
            <details className="group rounded-lg border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-foreground">
                Destinations
                <span className="text-muted-foreground group-open:hidden">
                  {selection.type === "all" ? "All connected accounts" : "Custom"}
                </span>
              </summary>
              <div className="border-t border-border p-3">
                <StudioDestinationPicker
                  workspaceId={session.workspaceId}
                  value={selection}
                  onChange={setSelection}
                />
              </div>
            </details>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => void distribute("schedule")}
                disabled={busy !== null || !scheduleAt || revising}
              >
                <CalendarClock />
                {busy === "schedule" ? "Scheduling…" : "Schedule"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void distribute("publish")}
                disabled={busy !== null || revising}
              >
                <Send />
                {busy === "publish" ? "Sending…" : "Publish now"}
              </Button>
            </div>
            {rows.length > deliverable.length ? (
              <p className="text-xs text-muted-foreground">
                {rows.length - deliverable.length} version
                {rows.length - deliverable.length === 1 ? " isn't" : "s aren't"} supported for
                direct publishing — copy {rows.length - deliverable.length === 1 ? "it" : "them"} to
                post.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {shippableType && sdr && !sdr.enabled
                ? "Direct publishing isn't enabled for this workspace. Copy or download it to post."
                : shippableType && !deliverable.length
                  ? "These platforms don't support direct publishing yet. Copy or download to post."
                  : session.type === "article"
                    ? "Approved and ready for your blog."
                    : "Approved and ready to use."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={copyText}>
                <Copy />
                Copy
              </Button>
              {media?.status === "ready" && media.url ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={media.url} download target="_blank" rel="noreferrer">
                    <Download />
                    Download
                  </a>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openComposer({ type: session.type })}
                >
                  <Plus />
                  New
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );
  })();

  return (
    // Mobile: one scrolling column (preview, then inspector). Desktop: the
    // canvas and inspector scroll independently side by side.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      {/* ── Canvas ── */}
      <div className="flex shrink-0 flex-col lg:min-h-0 lg:overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-5">
          {multi ? (
            <div role="tablist" aria-label="Platform versions" className="flex flex-wrap gap-1">
              {platforms.map((p) => {
                const spec = PLATFORMS[p];
                const Icon = spec.icon;
                const selected = p === current;
                const v = draft.variants?.find((x) => x.platform === p);
                const over = v ? v.body.length > spec.maxChars : false;
                return (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActive(p)}
                    className={cn(
                      "relative inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                      selected
                        ? "bg-surface-2 text-foreground ring-1 ring-border"
                        : "text-muted-foreground hover:bg-surface-2/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{spec.label}</span>
                    {over ? (
                      <span
                        aria-label="Over the character limit"
                        className="size-1.5 rounded-full bg-danger"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {platforms[0]
                ? `${PLATFORMS[platforms[0]].label} preview`
                : `${format.label} preview`}
            </p>
          )}

          <div className="ml-auto flex items-center gap-1">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(job.output);
                    setDirty(false);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={!dirty || busy === "save"}>
                  <Check />
                  {busy === "save" ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <>
                {session.type !== "script" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(true)}
                    disabled={revising || locked}
                  >
                    <Pencil />
                    Edit
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void generate(session.id, { kind: "regenerate" })}
                  disabled={revising || locked}
                  title="Same brief, a fresh take"
                >
                  <RefreshCw />
                  <span className="hidden sm:inline">New take</span>
                </Button>
                <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={copyText}
                  aria-label="Copy text"
                  title="Copy text"
                >
                  <Copy />
                </Button>
                {media?.status === "ready" && media.url ? (
                  <>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      asChild
                      aria-label="Download"
                      title="Download"
                    >
                      <a href={media.url} download target="_blank" rel="noreferrer">
                        <Download />
                      </a>
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setExpanded(true)}
                      aria-label="Expand preview"
                      title="Expand"
                    >
                      <Maximize2 />
                    </Button>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="relative bg-surface-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {partial.length || (session.error && !revising) ? (
            <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-4 pt-4">
              {partial.length ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-surface px-3 py-2.5 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Most of this is ready, but not all of it.</p>
                    <ul className="mt-0.5 text-xs text-muted-foreground">
                      {partial.map((p, i) => (
                        <li key={i}>
                          {p.target in PLATFORMS
                            ? PLATFORMS[p.target as PlatformId].label
                            : p.target === "media"
                              ? "Visual"
                              : "Captions"}
                          : {p.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revising}
                    onClick={() =>
                      partial.some((p) => p.target === "media")
                        ? retryMedia()
                        : void generate(session.id, { kind: "regenerate" })
                    }
                  >
                    <RefreshCw />
                    Retry
                  </Button>
                </div>
              ) : null}
              {session.error && !revising ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-danger-border bg-danger-surface px-3 py-2.5 text-sm text-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                  <p className="flex-1">
                    <span className="font-medium">That revision didn't go through.</span>{" "}
                    {session.error} Your previous version is unchanged.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              "flex justify-center px-4 py-6 transition-opacity duration-[--motion-duration-slow] md:px-8 md:py-10",
              revising && "pointer-events-none opacity-40",
            )}
          >
            {preview}
          </div>

          <AnimatePresence>
            {revising ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="sticky bottom-5 mx-auto mb-5 flex w-fit items-center gap-3 rounded-full border border-border bg-surface-4 py-1.5 pl-4 pr-1.5 shadow-3"
                role="status"
                aria-live="polite"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                <span className="text-sm text-foreground">
                  {format.stages.find((s) => s.id === session.job?.stage)?.label ??
                    (session.pendingKind === "refine" ? "Revising" : "Writing a new take")}
                  …
                </span>
                <Button size="sm" variant="ghost" onClick={() => void cancelSession(session.id)}>
                  <X />
                  Cancel
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Inspector ── */}
      <aside
        id="studio-inspector"
        className="border-t border-border bg-surface-3 lg:overflow-y-auto lg:border-l lg:border-t-0"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
          <StatusPill status={groupStatus} />
          {job.attempt > 1 ? (
            <span className="text-xs text-muted-foreground">Version {job.attempt}</span>
          ) : null}
          {draft.angle ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
              <Sparkles className="size-3 text-primary" />
              {draft.angle}
            </span>
          ) : null}
        </div>

        <InspectorSection title={locked ? "Delivery" : approvable ? "Next step" : "Ship it"}>
          {nextStep}
        </InspectorSection>

        {!locked ? (
          <InspectorSection title="Improve">
            {multi ? (
              <div
                role="radiogroup"
                aria-label="Apply to"
                className="mb-3 inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border"
              >
                {(["all", "one"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => setScope(s)}
                    className={cn(
                      "min-h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                      scope === s
                        ? "bg-surface-3 text-foreground shadow-1"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s === "all"
                      ? "All platforms"
                      : `${current ? PLATFORMS[current].label : "This"} only`}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {REFINE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={revising || editing}
                  onClick={() => refine(p.instruction, refineTarget, p.id)}
                  className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface-3 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary-border hover:bg-primary-surface disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
              {hasMedia || media?.status === "failed" ? (
                <button
                  type="button"
                  disabled={revising || editing}
                  onClick={() =>
                    refine(
                      "Create a fresh take on the visual with a different composition.",
                      "media",
                    )
                  }
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface-3 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary-border hover:bg-primary-surface disabled:opacity-50"
                >
                  <RefreshCw className="size-3" />
                  Retake visual
                </button>
              ) : null}
            </div>
            <form
              className="mt-3 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim().length < 2) return;
                refine(custom.trim());
                setCustom("");
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                disabled={revising || editing}
                placeholder="Describe a change…"
                aria-label="Describe a change"
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-surface-2 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50"
              />
              <Button
                type="submit"
                size="icon"
                variant="outline"
                disabled={custom.trim().length < 2 || revising}
                aria-label="Apply change"
              >
                <Wand2 />
              </Button>
            </form>
          </InspectorSection>
        ) : null}

        <InspectorSection title="Details">
          <dl className="space-y-2 text-xs [&_dd]:text-xs [&_dd]:leading-5 [&_dt]:text-xs [&_dt]:leading-5">
            {platforms.length ? (
              <div className="space-y-1.5">
                {platforms.map((p) => {
                  const spec = PLATFORMS[p];
                  const Icon = spec.icon;
                  const v = draft.variants?.find((x) => x.platform === p);
                  const len = v?.body.length ?? 0;
                  const row = rows.find((r) => r.meta?.platform === p);
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <Icon className="size-3.5 text-muted-foreground" />
                      <dt className="flex-1 text-foreground">{spec.label}</dt>
                      {v ? (
                        <dd
                          className={cn(
                            "tabular-nums",
                            len > spec.maxChars
                              ? "font-medium text-danger"
                              : "text-muted-foreground",
                          )}
                        >
                          {len.toLocaleString()}/{spec.maxChars.toLocaleString()}
                        </dd>
                      ) : null}
                      {row && STATUS_COPY[row.status] && row.status !== groupStatus ? (
                        <dd className="text-muted-foreground">· {STATUS_COPY[row.status].label}</dd>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {media ? (
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="text-muted-foreground">
                  {media.kind === "video" ? "Video" : "Visual"}
                </dt>
                <dd className="text-foreground">
                  {RATIOS[ratio].label} {ratio} ·{" "}
                  {media.status === "ready"
                    ? "Saved to Library"
                    : media.status === "pending"
                      ? "Rendering"
                      : "Failed"}
                </dd>
              </div>
            ) : null}
            {draft.article ? (
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="text-muted-foreground">Length</dt>
                <dd className="text-foreground">
                  {draft.article.markdown.split(/\s+/).filter(Boolean).length.toLocaleString()}{" "}
                  words
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-border pt-2">
              <dt className="shrink-0 text-muted-foreground">Brief</dt>
              <dd className="ml-4 line-clamp-3 min-w-0 text-right text-foreground">
                {session.brief}
              </dd>
            </div>
          </dl>
        </InspectorSection>
      </aside>

      {/* Mobile: keep the next step in reach while scrolling the preview. */}
      {!locked && !editing ? (
        <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-surface-3/95 px-4 py-3 backdrop-blur lg:hidden">
          {approvable ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void discard()}
                disabled={revising || busy !== null}
              >
                Discard
              </Button>
              <Button
                className="flex-1"
                onClick={() => void approve()}
                disabled={revising || busy !== null}
              >
                <Check />
                {busy === "approve"
                  ? "Approving…"
                  : multi
                    ? `Approve all ${platforms.length}`
                    : "Approve"}
              </Button>
            </>
          ) : (
            <Button
              variant={canShip ? "default" : "outline"}
              className="flex-1"
              onClick={() =>
                document
                  .getElementById("studio-inspector")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {canShip ? <CalendarClock /> : <Copy />}
              {canShip ? "Schedule or publish" : "Copy or download"}
            </Button>
          )}
        </div>
      ) : null}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[min(96vw,1100px)] border-none bg-surface-1 p-4 sm:p-6">
          <DialogTitle className="sr-only">Expanded preview</DialogTitle>
          {media ? (
            <MediaFrame
              media={media}
              ratio={ratio}
              alt={draft.altText ?? draft.title ?? "Generated visual"}
              maxHeight={Math.round(
                (typeof window !== "undefined" ? window.innerHeight : 900) * 0.8,
              )}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
