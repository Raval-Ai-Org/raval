"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { Maximize2 } from "lucide-react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Copy,
  Download,
  Eye,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Spinner,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
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
import { readBrandPayload } from "@/lib/studio/client";
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
import { ArticlePreview, SearchSnippet } from "./previews/ArticlePreview";
import { usePreviewBrand } from "./previews/brand";
import { CarouselPreview } from "./previews/CarouselPreview";
import { MediaLightbox } from "./previews/MediaLightbox";
import { ScriptPreview } from "./previews/ScriptPreview";
import { SocialPostPreview } from "./previews/SocialPostPreview";
import { Burst, DrawCheck } from "./studio-ui";

export type ReviewRow = {
  id: string;
  status: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  scheduled_at: string | null;
};

/** Used only until the workspace's distribution status has loaded (and in fixtures). */
const FALLBACK_DELIVERABLE: PlatformId[] = ["linkedin", "twitter", "facebook", "instagram"];
const SHIPPABLE_TYPES = ["social", "image", "video", "carousel"];

type Tone = "warn" | "ok" | "muted" | "danger";

const STATUS_COPY: Record<string, { label: string; tone: Tone }> = {
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

const TONE_PLATE: Record<Tone, string> = {
  warn: "bg-gradient-to-br from-warning-surface to-warning/25 text-warning ring-warning-border",
  ok: "studio-cta !overflow-visible text-primary-foreground ring-primary/40",
  danger: "bg-danger-surface text-danger ring-danger-border",
  muted: "bg-surface-2 text-muted-foreground ring-border",
};

const TOOL =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground transition-colors duration-[--motion-duration-fast] hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-3.5";
const TOOL_ICON =
  "grid size-8 place-items-center rounded-full text-foreground/80 transition-colors duration-[--motion-duration-fast] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-3.5";
const FLOAT = "rounded-full bg-surface-3/90 p-1 shadow-2 ring-1 ring-border/70 backdrop-blur";

function defaultScheduleTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function InspectorSection({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section data-no-rhythm className={cn("px-5 py-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="ui-eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Check = {
  key: string;
  state: "ok" | "warn" | "fail" | "busy" | "info";
  label: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
};

function CheckRow({ check, index }: { check: Check; index: number }) {
  return (
    <motion.li
      className="flex items-center gap-3 py-1.5"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + index * 0.06, duration: duration.slow, ease: ease.emphasized }}
    >
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          check.state === "ok" && "bg-primary-surface text-primary ring-1 ring-primary-border",
          check.state === "warn" && "bg-warning-surface text-warning ring-1 ring-warning-border",
          check.state === "fail" && "bg-danger-surface text-danger ring-1 ring-danger-border",
          check.state === "busy" && "bg-surface-2 text-muted-foreground ring-1 ring-border",
          check.state === "info" && "bg-surface-2 text-muted-foreground ring-1 ring-border",
        )}
      >
        {check.state === "ok" ? (
          <Check className="size-3" strokeWidth={3} />
        ) : check.state === "busy" ? (
          <Spinner className="size-3 animate-spin" />
        ) : check.state === "info" ? (
          <Info className="size-3" />
        ) : (
          <AlertTriangle className="size-3" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{check.label}</span>
      {check.detail ? (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            check.state === "fail" ? "font-medium text-danger" : "text-muted-foreground",
          )}
        >
          {check.detail}
        </span>
      ) : null}
      {check.action}
    </motion.li>
  );
}

/**
 * Review: the result staged on a canvas exactly as it will ship, and beside it
 * an inspector that makes the state and the next step unmistakable — approve,
 * then schedule or publish — with checks and one-click improvements.
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
  const hasBrand = useMemo(() => !!readBrandPayload(session.workspaceId), [session.workspaceId]);
  const reduce = useReducedMotion();
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
  const [tiktokPrivacy, setTiktokPrivacy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [justApproved, setJustApproved] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A result that finished moments ago gets a short "ready" beat on arrival.
  const [fresh, setFresh] = useState(
    () => !!job.completed_at && Date.now() - Date.parse(job.completed_at) < 8000,
  );

  useEffect(() => {
    if (!dirty) setDraft(job.output);
  }, [job.output, dirty]);
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => setFresh(false), 4500);
    return () => window.clearTimeout(t);
  }, [fresh]);
  useEffect(() => {
    if (!confirmDiscard) return;
    const t = window.setTimeout(() => setConfirmDiscard(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmDiscard]);

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
  const deliverablePlatforms: readonly string[] = sdr?.platforms?.length
    ? sdr.platforms
    : FALLBACK_DELIVERABLE;
  const deliverable = rows.filter((r) => deliverablePlatforms.includes(String(r.meta?.platform)));
  const sendsTiktok = deliverable.some((r) => r.meta?.platform === "tiktok");
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
        description: approvable ? undefined : "Edited work goes back for approval.",
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
      const options = { tiktokPrivacyLevel: sendsTiktok ? tiktokPrivacy : null };
      const res =
        kind === "publish"
          ? await publishContentItems(session.workspaceId, ids, selection, options)
          : await scheduleContentItems(
              session.workspaceId,
              ids.map((id, i) => ({
                contentItemId: id,
                scheduledAt: new Date(
                  new Date(scheduleAt).getTime() + i * 10 * 60_000,
                ).toISOString(),
              })),
              selection,
              options,
            );
      const sent = res.results.filter((r) => r.status === "publishing" || r.status === "already");
      // `failed` = accepted by the provider but rejected by every destination.
      const skipped = res.results.filter((r) => r.status === "skipped" || r.status === "failed");
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
      setConfirmDiscard(false);
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

  const cancelEdit = () => {
    setDraft(job.output);
    setDirty(false);
    setEditing(false);
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
            kicker={draft.angle}
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
          <div className="grid w-full max-w-[1000px] items-start justify-center gap-10 2xl:grid-cols-2">
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
  const mediaReady = media?.status === "ready" && !!media.url;
  const firstScheduled = rows.find((r) => r.scheduled_at)?.scheduled_at;
  const words = draft.article?.markdown.split(/\s+/).filter(Boolean).length ?? 0;
  const tookSeconds =
    job.completed_at && job.created_at
      ? Math.round((Date.parse(job.completed_at) - Date.parse(job.created_at)) / 1000)
      : null;

  /* ── Status: one unmistakable statement of where this piece stands ── */
  const hero = (() => {
    const s = STATUS_COPY[groupStatus] ?? { label: groupStatus, tone: "muted" as Tone };
    const versions = multi ? `${platforms.length} platform versions` : format.label;
    switch (groupStatus) {
      case "pending":
      case "draft":
        return {
          tone: "warn" as Tone,
          icon: <Eye className="size-4" />,
          title: "Needs your approval",
          sub: `${versions} · nothing goes out until you approve`,
        };
      case "approved":
        return {
          tone: "ok" as Tone,
          icon: <DrawCheck className="size-4" delay={justApproved ? 0.1 : 0} />,
          title: "Approved",
          sub: canShip ? "Ready to schedule or publish" : "Ready to copy, download and post",
        };
      case "scheduled":
        return {
          tone: "ok" as Tone,
          icon: <CalendarClock className="size-4" />,
          title: "Scheduled",
          sub: firstScheduled
            ? new Date(firstScheduled).toLocaleString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "Queued with your connected accounts",
        };
      case "publishing":
        return {
          tone: "ok" as Tone,
          icon: <Spinner className="size-4 animate-spin" />,
          title: "Publishing",
          sub: "Sending to your connected accounts",
        };
      case "published":
        return {
          tone: "ok" as Tone,
          icon: <Send className="size-4" />,
          title: "Published",
          sub: "Live on your connected accounts",
        };
      default:
        return {
          tone: s.tone,
          icon: <AlertTriangle className="size-4" />,
          title: s.label,
          sub: s.tone === "danger" ? "See delivery details below" : versions,
        };
    }
  })();

  /* ── Checks: what a careful editor would verify before approving ── */
  const checks: Check[] = [];
  if (draft.variants?.length) {
    for (const p of platforms) {
      const spec = PLATFORMS[p];
      const v = draft.variants.find((x) => x.platform === p);
      if (!v) continue;
      const Icon = spec.icon;
      const over = v.body.length > spec.maxChars;
      checks.push({
        key: p,
        state: over ? "fail" : "ok",
        label: (
          <span className="flex items-center gap-2">
            <Icon className="size-3.5 text-muted-foreground" />
            {spec.label}
            {over ? <span className="text-xs text-danger">over the limit</span> : null}
          </span>
        ),
        detail: `${v.body.length.toLocaleString()}/${spec.maxChars.toLocaleString()}`,
      });
    }
  }
  if (media) {
    checks.push(
      media.status === "ready"
        ? {
            key: "media",
            state: "ok",
            label: media.kind === "video" ? "Video rendered" : "Visual rendered",
            detail: `${RATIOS[ratio].label} ${ratio}`,
          }
        : media.status === "pending"
          ? {
              key: "media",
              state: "busy",
              label: media.kind === "video" ? "Rendering video" : "Rendering visual",
              detail: ratio,
            }
          : {
              key: "media",
              state: "fail",
              label:
                media.kind === "video" ? "Video couldn't be created" : "Image couldn't be created",
              action: (
                <button
                  type="button"
                  onClick={retryMedia}
                  disabled={revising}
                  className="shrink-0 text-xs font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Retry
                </button>
              ),
            },
    );
  }
  if (draft.article) {
    checks.push({
      key: "words",
      state: "ok",
      label: "Length",
      detail: `${words.toLocaleString()} words`,
    });
    checks.push({
      key: "takeaways",
      state: draft.article.takeaways.length ? "ok" : "warn",
      label: "Key takeaways",
      detail: draft.article.takeaways.length || "None",
    });
  }
  if (draft.slides?.length) {
    checks.push({
      key: "slides",
      state: "ok",
      label: "Slides designed",
      detail: draft.slides.length,
    });
  }
  if (draft.script) {
    checks.push({
      key: "beats",
      state: "ok",
      label: "Beats",
      detail: `${draft.script.beats.length} · ~${draft.script.durationSec}s`,
    });
  }
  if (draft.ads?.length) {
    const long = draft.ads.filter((a) => a.headline.length > 40).length;
    checks.push({
      key: "headlines",
      state: long ? "warn" : "ok",
      label: "Headlines within 40 characters",
      detail: long ? `${long} long` : `${draft.ads.length} variants`,
    });
  }
  checks.push(
    hasBrand
      ? { key: "brand", state: "ok", label: "Brand DNA applied" }
      : {
          key: "brand",
          state: "info",
          label: "No Brand DNA yet",
          action: (
            <button
              type="button"
              onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
              className="shrink-0 text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              Add
            </button>
          ),
        },
  );
  const failing = checks.filter((c) => c.state === "fail").length;

  /* ── Primary actions: always pinned where the thumb and eye expect them ── */
  const actions = (
    <AnimatePresence mode="wait" initial={false}>
      {locked ? (
        <motion.div key="locked" {...fadeSwap} className="flex w-full gap-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => openComposer({ type: session.type })}
          >
            <Plus />
            Create another {format.noun}
          </Button>
        </motion.div>
      ) : approvable && confirmDiscard ? (
        <motion.div key="confirm" {...fadeSwap} className="flex w-full items-center gap-2">
          <span className="mr-auto pl-1 text-sm text-foreground">Discard this {format.noun}?</span>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(false)}>
            Keep
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-danger"
            loading={busy === "discard"}
            onClick={() => void discard()}
          >
            Discard
          </Button>
        </motion.div>
      ) : approvable ? (
        <motion.div key="approve" {...fadeSwap} className="flex w-full items-center gap-2">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirmDiscard(true)}
            disabled={revising || busy !== null}
          >
            Discard
          </Button>
          <Button
            className="studio-cta flex-1"
            size="lg"
            onClick={() => void approve()}
            loading={busy === "approve"}
            disabled={revising || busy !== null || editing}
            title={failing ? "Some checks need attention — you can still approve" : undefined}
          >
            <Check />
            {multi ? `Approve all ${platforms.length}` : "Approve"}
          </Button>
        </motion.div>
      ) : canShip ? (
        <motion.div key="ship" {...fadeSwap} className="grid w-full grid-cols-[auto_1fr] gap-2">
          <Button
            variant="outline"
            size="lg"
            onClick={() => void distribute("publish")}
            loading={busy === "publish"}
            disabled={busy !== null || revising}
          >
            <Send />
            Publish now
          </Button>
          <Button
            size="lg"
            className="studio-cta"
            onClick={() => void distribute("schedule")}
            loading={busy === "schedule"}
            disabled={busy !== null || !scheduleAt || revising}
          >
            <CalendarClock />
            Schedule
          </Button>
        </motion.div>
      ) : (
        <motion.div key="use" {...fadeSwap} className="grid w-full grid-cols-2 gap-2">
          <Button variant={mediaReady ? "outline" : "default"} size="lg" onClick={copyText}>
            <Copy />
            Copy {session.type === "article" ? "article" : "text"}
          </Button>
          {mediaReady ? (
            <Button size="lg" asChild>
              <a href={media!.url} download target="_blank" rel="noreferrer">
                <Download />
                Download
              </a>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              onClick={() => openComposer({ type: session.type })}
            >
              <Plus />
              New {format.noun}
            </Button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    // Mobile: one scrolling column (preview, then inspector) with the primary
    // action pinned. Desktop: canvas and inspector scroll independently.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto @5xl/composer:grid @5xl/composer:grid-cols-[minmax(0,1fr)_380px] @5xl/composer:grid-rows-[minmax(0,1fr)] @5xl/composer:overflow-hidden">
      {/* ── Canvas ── */}
      <div className="studio-canvas relative flex shrink-0 flex-col @5xl/composer:min-h-0 @5xl/composer:overflow-y-auto">
        <div
          aria-hidden
          className={`studio-aurora studio-aurora-soft studio-tone-${session.type} !bottom-auto h-[560px]`}
        />

        {/* Floating toolbar */}
        <div className="pointer-events-none sticky top-0 z-20 flex flex-wrap items-center gap-2 px-3 pb-2 pt-3 @3xl/composer:px-5 @3xl/composer:pt-4">
          {multi ? (
            <div
              role="tablist"
              aria-label="Platform versions"
              className={cn("pointer-events-auto flex", FLOAT)}
            >
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
                      "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-[--motion-duration-fast]",
                      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {selected ? (
                      <motion.span
                        layoutId={`platform-tab-${session.id}`}
                        className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-border/70"
                        transition={{ duration: duration.medium, ease: ease.emphasized }}
                      />
                    ) : null}
                    <Icon className="relative size-3.5" />
                    <span className="relative hidden sm:inline">{spec.label}</span>
                    {over ? (
                      <span
                        aria-label="Over the character limit"
                        className="relative size-1.5 rounded-full bg-danger"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <span
              className={cn(
                "pointer-events-auto inline-flex h-10 items-center gap-2 px-4 text-xs text-muted-foreground",
                FLOAT,
              )}
            >
              {platforms[0] ? (
                <>
                  {(() => {
                    const Icon = PLATFORMS[platforms[0]].icon;
                    return <Icon className="size-3.5 text-foreground" />;
                  })()}
                  <span className="font-medium text-foreground">
                    {PLATFORMS[platforms[0]].label}
                  </span>{" "}
                  preview
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{format.label}</span> preview
                </>
              )}
            </span>
          )}

          <AnimatePresence initial={false}>
            {!editing ? (
              <motion.div
                key="tools"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: duration.base }}
                className={cn("pointer-events-auto ml-auto flex items-center", FLOAT)}
              >
                {session.type !== "script" ? (
                  <button
                    type="button"
                    className={TOOL}
                    onClick={() => setEditing(true)}
                    disabled={revising || locked}
                  >
                    <Pencil />
                    Edit
                  </button>
                ) : null}
                <button
                  type="button"
                  className={TOOL}
                  onClick={() => void generate(session.id, { kind: "regenerate" })}
                  disabled={revising || locked}
                  title="Same description, a new version"
                >
                  <RefreshCw />
                  <span className="hidden sm:inline">New take</span>
                </button>
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  className={TOOL_ICON}
                  onClick={copyText}
                  aria-label="Copy text"
                  title="Copy text"
                >
                  <Copy />
                </button>
                {mediaReady ? (
                  <>
                    <a
                      href={media!.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className={TOOL_ICON}
                      aria-label="Download"
                      title="Download"
                    >
                      <Download />
                    </a>
                    <button
                      type="button"
                      className={TOOL_ICON}
                      onClick={() => setExpanded(true)}
                      aria-label="Open full size"
                      title="Open full size"
                    >
                      <Maximize2 />
                    </button>
                  </>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Arrival beat */}
        <AnimatePresence>
          {fresh && !revising ? (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, transition: { duration: duration.base } }}
              transition={{ duration: duration.slow, ease: ease.emphasized }}
              className="pointer-events-none relative z-10 flex justify-center px-4 pb-1 @7xl/composer:absolute @7xl/composer:left-1/2 @7xl/composer:top-6 @7xl/composer:z-30 @7xl/composer:block @7xl/composer:-translate-x-1/2 @7xl/composer:p-0"
              role="status"
            >
              <span className="inline-flex h-7 items-center gap-2 studio-cta studio-shine relative whitespace-nowrap rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground">
                <DrawCheck className="size-3.5" delay={0.2} strokeWidth={3} />
                Ready for review{tookSeconds ? ` · made in ${tookSeconds}s` : ""}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {partial.length || (session.error && !revising) ? (
          <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col gap-2 px-4 pt-2">
            {partial.length ? (
              <div className="flex items-start gap-3 rounded-xl bg-surface-3 px-3.5 py-3 text-sm text-foreground shadow-2 ring-1 ring-warning-border">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-warning-surface">
                  <AlertTriangle className="size-3.5 text-warning" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Most of this is ready</p>
                  <ul className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
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
                className="flex items-start gap-3 rounded-xl bg-surface-3 px-3.5 py-3 text-sm text-foreground shadow-2 ring-1 ring-danger-border"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-danger-surface">
                  <AlertTriangle className="size-3.5 text-danger" />
                </span>
                <p className="flex-1 leading-relaxed">
                  <span className="font-medium">That revision didn't go through.</span>{" "}
                  <span className="text-muted-foreground">
                    {session.error} Your previous version is unchanged.
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Stage */}
        <div className="relative flex flex-1 justify-center px-4 pb-28 pt-4 @3xl/composer:px-10 @3xl/composer:pt-6">
          <AnimatePresence>
            {justApproved && !reduce ? (
              <motion.span
                key="glow"
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(38%_42%_at_50%_38%,hsl(var(--primary)/0.22),transparent_72%)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.6, times: [0, 0.25, 1], ease: "easeOut" }}
              />
            ) : null}
          </AnimatePresence>
          <motion.div
            key={`${session.type}-${session.type === "ad" ? "ad" : current}-${editing ? "edit" : "view"}`}
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: fresh ? 18 : 8, scale: fresh ? 0.975 : 1 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: fresh ? duration.xslow : duration.medium,
              ease: ease.emphasized,
            }}
            className={cn(
              "relative flex w-full justify-center transition-[opacity,filter] duration-[--motion-duration-slow]",
              revising && "pointer-events-none opacity-45 blur-[1.5px] saturate-50",
            )}
          >
            {preview}
          </motion.div>
        </div>

        {/* Bottom bars: editing and revising */}
        <AnimatePresence>
          {editing ? (
            <motion.div
              key="editbar"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
              className="sticky bottom-4 z-20 mx-auto -mt-16 mb-4 shrink-0 flex w-fit items-center gap-2 rounded-full bg-surface-4 py-1.5 pl-4 pr-1.5 shadow-4 ring-1 ring-border"
            >
              <span className={cn("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-primary")} />
              <span className="mr-2 text-sm text-foreground">
                {dirty
                  ? "Unsaved changes"
                  : `Editing${multi && current ? ` ${PLATFORMS[current].label}` : ""}`}
              </span>
              <Button size="sm" variant="ghost" className="rounded-full" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => void save()}
                disabled={!dirty}
                loading={busy === "save"}
              >
                <Check />
                Save changes
              </Button>
            </motion.div>
          ) : revising ? (
            <motion.div
              key="revising"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
              className="sticky bottom-4 z-20 mx-auto -mt-16 mb-4 shrink-0 w-fit overflow-hidden rounded-full bg-surface-4 shadow-4 ring-1 ring-border"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-3 py-1.5 pl-4 pr-1.5">
                <Sparkles className="size-4 text-primary" />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={session.job?.stage ?? "start"}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: duration.base }}
                    className="text-sm text-foreground"
                  >
                    {format.stages.find((s) => s.id === session.job?.stage)?.label ??
                      (session.pendingKind === "refine" ? "Revising" : "Writing a new take")}
                    …
                  </motion.span>
                </AnimatePresence>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => void cancelSession(session.id)}
                >
                  <X />
                  Stop
                </Button>
              </div>
              <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
                <motion.span
                  className="absolute inset-y-0 w-1/3 bg-primary"
                  animate={reduce ? undefined : { x: ["-100%", "300%"] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* ── Inspector ── */}
      <aside
        id="studio-inspector"
        className="flex flex-col border-t border-border/70 bg-surface-3 @5xl/composer:min-h-0 @5xl/composer:border-l @5xl/composer:border-t-0"
      >
        <div className="studio-stagger min-h-0 flex-1 divide-y divide-border/60 @5xl/composer:overflow-y-auto">
          {/* Status */}
          <div className="px-5 pb-5 pt-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={groupStatus}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
                className="flex items-start gap-3"
              >
                <span
                  className={cn(
                    "relative grid size-10 shrink-0 place-items-center rounded-xl ring-1",
                    TONE_PLATE[hero.tone],
                    hero.tone === "warn" && "studio-halo",
                  )}
                >
                  {hero.icon}
                  {groupStatus === "approved" && justApproved ? <Burst radius={40} /> : null}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                    {hero.title}
                  </p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">{hero.sub}</p>
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                Version {job.attempt}
              </span>
              {draft.angle ? (
                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-primary-surface px-2.5 text-[11px] font-medium text-foreground ring-1 ring-primary-border">
                  <Sparkles className="size-3 text-primary" />
                  {draft.angle}
                </span>
              ) : null}
              {revising ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-[11px] font-medium text-muted-foreground">
                  <Spinner className="size-3 animate-spin" />
                  New version in progress
                </span>
              ) : null}
            </div>
            <div className="mt-5 hidden @5xl/composer:flex">{actions}</div>
          </div>

          {locked ? (
            <InspectorSection title="Delivery">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {groupStatus === "published"
                  ? "Published. Delivery details for each account are below."
                  : "Sent to your connected accounts. You'll see each delivery here."}
              </p>
              {rows[0] && !fixtureRows ? (
                <div className="mt-3">
                  <DeliveryView workspaceId={session.workspaceId} contentItemId={rows[0].id} />
                </div>
              ) : null}
            </InspectorSection>
          ) : !approvable && canShip ? (
            <InspectorSection title="Schedule">
              <label htmlFor="studio-schedule-at" className="sr-only">
                Schedule for
              </label>
              <input
                id="studio-schedule-at"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-foreground outline-none ring-1 ring-border transition-shadow focus-visible:ring-2 focus-visible:ring-primary"
              />
              {deliverable.length > 1 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Platforms go out 10 minutes apart.
                </p>
              ) : null}
              <details className="group mt-3 rounded-xl bg-surface-2/60">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium text-foreground">
                  Destinations
                  <span className="text-muted-foreground group-open:hidden">
                    {selection.type === "all" ? "All connected accounts" : "Custom"}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <StudioDestinationPicker
                    workspaceId={session.workspaceId}
                    value={selection}
                    onChange={setSelection}
                    tiktok={
                      sendsTiktok ? { value: tiktokPrivacy, onChange: setTiktokPrivacy } : undefined
                    }
                  />
                </div>
              </details>
              {rows.length > deliverable.length ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {rows.length - deliverable.length} version
                  {rows.length - deliverable.length === 1 ? " isn't" : "s aren't"} supported for
                  direct publishing — copy {rows.length - deliverable.length === 1 ? "it" : "them"}{" "}
                  to post.
                </p>
              ) : null}
            </InspectorSection>
          ) : !approvable && shippableType && sdr && !sdr.enabled ? (
            <InspectorSection title="Publishing">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Direct publishing isn't enabled for this workspace. Copy or download it to post.
              </p>
            </InspectorSection>
          ) : null}

          <InspectorSection
            title="Checks"
            aside={
              <span className={cn("text-xs", failing ? "text-danger" : "text-muted-foreground")}>
                {failing ? `${failing} to fix` : "All clear"}
              </span>
            }
          >
            <ul className="-my-1.5">
              {checks.map((c, i) => (
                <CheckRow key={c.key} check={c} index={i} />
              ))}
            </ul>
          </InspectorSection>

          {draft.article ? (
            <InspectorSection title="Search result">
              <SearchSnippet article={draft.article} brand={brand} />
            </InspectorSection>
          ) : null}

          {!locked ? (
            <InspectorSection
              title="Improve"
              aside={
                multi ? (
                  <div
                    role="radiogroup"
                    aria-label="Apply to"
                    className="inline-flex rounded-full bg-surface-2 p-0.5"
                  >
                    {(["all", "one"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={scope === s}
                        onClick={() => setScope(s)}
                        className={cn(
                          "h-6 rounded-full px-2.5 text-[11px] font-medium transition-colors",
                          scope === s
                            ? "bg-surface-3 text-foreground shadow-1"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {s === "all"
                          ? "All"
                          : current
                            ? PLATFORMS[current].label.split(" ")[0]
                            : "This"}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            >
              <form
                data-no-rhythm
                className="flex items-center gap-1 rounded-xl bg-surface-2 p-1 pl-3 ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-primary"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim().length < 2) return;
                  refine(custom.trim());
                  setCustom("");
                }}
              >
                <Wand2 className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  disabled={revising || editing}
                  placeholder="Describe a change…"
                  aria-label="Describe a change"
                  className="h-8 min-w-0 flex-1 !border-0 !bg-transparent px-1.5 text-sm !shadow-none outline-none placeholder:text-muted-foreground focus-visible:!ring-0 disabled:opacity-50"
                />
                <Button
                  type="submit"
                  size="icon-sm"
                  className="rounded-lg"
                  disabled={custom.trim().length < 2 || revising}
                  aria-label="Apply change"
                >
                  <Send />
                </Button>
              </form>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {REFINE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={revising || editing}
                    onClick={() => refine(p.instruction, refineTarget, p.id)}
                    className="inline-flex h-8 items-center rounded-full bg-surface-2/70 px-3 text-xs font-medium text-foreground ring-1 ring-transparent transition-[background-color,box-shadow,translate] duration-[--motion-duration-fast] hover:-translate-y-px hover:bg-primary-surface hover:shadow-1 hover:ring-primary-border disabled:opacity-45"
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
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2/70 px-3 text-xs font-medium text-foreground ring-1 ring-transparent transition-[background-color,box-shadow,translate] duration-[--motion-duration-fast] hover:-translate-y-px hover:bg-primary-surface hover:shadow-1 hover:ring-primary-border disabled:opacity-45"
                  >
                    <RefreshCw className="size-3" />
                    Retake visual
                  </button>
                ) : null}
              </div>
            </InspectorSection>
          ) : null}

          <InspectorSection title="Brief">
            <p className="line-clamp-4 border-l-2 border-primary/50 pl-3 text-sm leading-relaxed text-foreground/85">
              {session.brief}
            </p>
          </InspectorSection>
        </div>
      </aside>

      {/* Mobile: the next step stays in reach while scrolling the preview. */}
      {!editing ? (
        <div className="sticky bottom-0 z-30 flex items-center gap-2 border-t border-border/70 bg-surface-3/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur @5xl/composer:hidden">
          {actions}
        </div>
      ) : null}

      <MediaLightbox
        open={expanded}
        onOpenChange={setExpanded}
        media={media}
        ratio={ratio}
        alt={draft.altText ?? draft.title ?? "Generated visual"}
        title={draft.title ?? format.label}
      />
    </div>
  );
}

const fadeSwap = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: duration.base, ease: ease.standard },
} as const;
