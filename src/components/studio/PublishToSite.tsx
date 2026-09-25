"use client";

// PublishToSite — put an approved Studio article on the workspace's own website
// (WordPress post, Webflow blog item, or a GitHub pull request) and show
// whether the live page really carries it. Every state comes from the server
// (src/server/articles/publish.server.ts); nothing is sent before the button.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle,
  ExternalLink,
  Globe,
  RefreshCw,
  Send,
  Settings,
  Spinner,
  XCircle,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { emitAppEvent } from "@/lib/app-events";
import type { PublicationView, PublishPreview } from "@/lib/articles/contracts";
import { PUBLICATION_ACTIVE } from "@/lib/articles/contracts";
import {
  cancelArticlePublication,
  getArticlePublication,
  previewArticlePublish,
  publishArticle,
  recheckArticlePublication,
  setupSiteBlog,
} from "@/lib/site-publishing.functions";
import { cn } from "@/lib/utils";

const PLATFORM = { wordpress: "WordPress", webflow: "Webflow", github: "GitHub" } as const;

const STATUS: Record<
  PublicationView["status"],
  { label: string; tone: "ok" | "busy" | "warn" | "muted" }
> = {
  approved: { label: "Waiting to publish", tone: "busy" },
  publishing: { label: "Publishing", tone: "busy" },
  pr_open: { label: "Pull request open", tone: "busy" },
  published: { label: "Published", tone: "busy" },
  verifying: { label: "Checking the live page", tone: "busy" },
  verified: { label: "Live on your site", tone: "ok" },
  needs_attention: { label: "Needs attention", tone: "warn" },
  failed: { label: "Didn't publish", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const tomorrowNine = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-success" />
  ) : (
    <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
  );
}

function PublicationCard({
  workspaceId,
  publication,
  onChange,
}: {
  workspaceId: string;
  publication: PublicationView;
  onChange: (p: PublicationView) => void;
}) {
  const [busy, setBusy] = useState<"recheck" | "cancel" | null>(null);
  const s = STATUS[publication.status];
  const active = PUBLICATION_ACTIVE.includes(publication.status);
  const run = async (kind: "recheck" | "cancel") => {
    setBusy(kind);
    try {
      const fn = kind === "recheck" ? recheckArticlePublication : cancelArticlePublication;
      onChange(await fn({ data: { workspaceId, publicationId: publication.id } }));
    } catch (e) {
      toast.error(errMsg(e, "That didn't work"));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2 rounded-xl bg-surface-2/70 p-3 ring-1 ring-border/60">
      <div className="flex items-center gap-2 text-sm font-medium">
        {s.tone === "ok" ? (
          <CheckCircle className="size-4 text-success" />
        ) : s.tone === "warn" ? (
          <AlertTriangle className="size-4 text-warning" />
        ) : active ? (
          <Spinner className="size-4 animate-spin text-muted-foreground" />
        ) : null}
        {s.label}
      </div>
      {publication.statusDetail && publication.statusDetail !== s.label ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{publication.statusDetail}</p>
      ) : null}
      {publication.scheduledFor && publication.status === "approved" ? (
        <p className="text-xs text-muted-foreground">
          Goes out {new Date(publication.scheduledFor).toLocaleString()}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {publication.url &&
        ["published", "verifying", "verified", "needs_attention"].includes(publication.status) ? (
          <a
            href={publication.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
          >
            View page <ExternalLink className="size-3" />
          </a>
        ) : null}
        {publication.pr ? (
          <a
            href={publication.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
          >
            Pull request #{publication.pr.number} <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      {publication.checks.length ? (
        <ul className="space-y-1">
          {publication.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-1.5 text-xs">
              <Mark ok={c.ok} />
              <span>
                <span className="text-foreground">{c.label}</span>
                <span className="text-muted-foreground"> · {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {["needs_attention", "verified"].includes(publication.status) && publication.url ? (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "recheck"}
            onClick={() => void run("recheck")}
          >
            <RefreshCw className="size-3.5" /> Check again
          </Button>
        ) : null}
        {["approved", "needs_attention", "failed"].includes(publication.status) ? (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "cancel"}
            onClick={() => void run("cancel")}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PublishToSite({
  workspaceId,
  contentItemId,
}: {
  workspaceId: string;
  contentItemId: string;
}) {
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<string | undefined>(undefined);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [slugDraft, setSlugDraft] = useState<string | undefined>(undefined);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(tomorrowNine);
  const [busy, setBusy] = useState<"publish" | "blog" | "recheck" | null>(null);

  const load = useCallback(
    async (opts: { recheckBlog?: boolean } = {}) => {
      try {
        const next = await previewArticlePublish({
          data: { workspaceId, contentItemId, host, slug, recheckBlog: opts.recheckBlog },
        });
        setPreview(next);
        setError(null);
      } catch (e) {
        setError(errMsg(e, "Couldn't check your website"));
      }
    },
    [workspaceId, contentItemId, host, slug],
  );

  // Slug edits are committed on blur, so this reloads once per edit, not per keystroke.
  useEffect(() => {
    void load();
  }, [load]);

  const publication = preview?.publication ?? null;
  const active = !!publication && PUBLICATION_ACTIVE.includes(publication.status);
  useVisibleInterval(
    () => {
      if (!publication || !active) return;
      void getArticlePublication({ data: { workspaceId, publicationId: publication.id } })
        .then((p) => {
          if (p.status !== publication.status) void load();
          else setPreview((prev) => (prev ? { ...prev, publication: p } : prev));
        })
        .catch(() => undefined);
    },
    5000,
    [publication?.id, publication?.status, active],
  );

  if (error && !preview) return <ErrorState size="sm" detail={error} onRetry={() => void load()} />;
  if (!preview) return <Skeleton className="h-28 w-full rounded-xl" />;

  const platform = preview.site ? PLATFORM[preview.site.provider] : null;
  const blog = preview.blog;

  const publish = async () => {
    setBusy("publish");
    try {
      const p = await publishArticle({
        data: {
          workspaceId,
          contentItemId,
          host: preview.host ?? undefined,
          slug: preview.article.slug,
          scheduledFor: scheduling ? new Date(scheduleAt).toISOString() : null,
        },
      });
      setPreview({ ...preview, publication: p, canPublish: false });
      toast.success(
        scheduling
          ? "Scheduled"
          : preview.site?.provider === "github"
            ? "Opening a pull request"
            : `Publishing to ${platform}`,
      );
    } catch (e) {
      toast.error(errMsg(e, "Couldn't publish"));
      void load();
    } finally {
      setBusy(null);
    }
  };

  const setupBlog = async (action: "create" | "ready") => {
    if (!preview.host) return;
    setBusy("blog");
    try {
      await setupSiteBlog({ data: { workspaceId, action, host: preview.host } });
      toast.success(action === "create" ? "Blog created in Webflow" : "Thanks. Ready to publish");
      await load({ recheckBlog: action === "ready" ? false : true });
    } catch (e) {
      toast.error(errMsg(e, "That didn't work"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Where it goes */}
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border/60">
          <Globe className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {preview.targets.length > 1 ? (
            <select
              aria-label="Website"
              value={preview.host ?? ""}
              onChange={(e) => {
                setHost(e.target.value);
                setPreview(null);
              }}
              className="h-8 w-full truncate rounded-lg bg-surface-2 px-2 text-sm font-medium text-foreground outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary"
            >
              {preview.targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate text-sm font-medium text-foreground">
              {preview.host ?? "No website"}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {platform
              ? `${platform}${blog?.destination ? ` · ${blog.destination}` : ""}`
              : "Not connected"}
          </p>
        </div>
      </div>

      {!preview.site?.verified ? (
        <div className="space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{preview.reason}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => emitAppEvent("open:settings", { section: "website" })}
          >
            <Settings className="size-3.5" /> Connect your site
          </Button>
        </div>
      ) : null}

      {/* Blog setup */}
      {blog && blog.status === "missing" ? (
        <div className="space-y-2 rounded-xl bg-surface-2/70 p-3 text-xs ring-1 ring-border/60">
          <p className="leading-relaxed text-muted-foreground">{blog.detail}</p>
          {blog.canCreate ? (
            <Button size="sm" loading={busy === "blog"} onClick={() => void setupBlog("create")}>
              Create a blog in Webflow
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void load({ recheckBlog: true })}>
              <RefreshCw className="size-3.5" /> Check again
            </Button>
          )}
        </div>
      ) : null}
      {blog && blog.status === "needs_design" ? (
        <div className="space-y-2 rounded-xl bg-warning/5 p-3 text-xs ring-1 ring-warning/30">
          <p className="leading-relaxed">{blog.detail}</p>
          <Button
            size="sm"
            variant="outline"
            loading={busy === "blog"}
            onClick={() => void setupBlog("ready")}
          >
            It's ready
          </Button>
        </div>
      ) : null}
      {blog && blog.status === "failed" ? (
        <div className="space-y-2 text-xs">
          <p className="leading-relaxed text-danger">{blog.detail}</p>
          <Button size="sm" variant="outline" onClick={() => void load({ recheckBlog: true })}>
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        </div>
      ) : null}

      {publication && publication.status !== "cancelled" ? (
        <PublicationCard
          workspaceId={workspaceId}
          publication={publication}
          onChange={(p) => {
            setPreview({ ...preview, publication: p });
            if (!PUBLICATION_ACTIVE.includes(p.status)) void load();
          }}
        />
      ) : null}

      {/* Address + checks, before publishing */}
      {preview.site?.verified &&
      (!publication || ["cancelled", "failed", "needs_attention"].includes(publication.status)) ? (
        <>
          <label className="block">
            <span className="text-xs text-muted-foreground">Address</span>
            <div className="mt-1 flex h-9 items-center overflow-hidden rounded-lg bg-surface-2 text-sm ring-1 ring-border focus-within:ring-2 focus-within:ring-primary">
              <span className="shrink truncate pl-2.5 text-muted-foreground">
                {preview.article.url
                  ? preview.article.url.slice(
                      0,
                      preview.article.url.length - preview.article.slug.length,
                    )
                  : `${preview.host}/…/`}
              </span>
              <input
                value={slugDraft ?? preview.article.slug}
                onChange={(e) =>
                  setSlugDraft(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-")
                      .replace(/-{2,}/g, "-"),
                  )
                }
                onBlur={() => {
                  if (slugDraft === undefined) return;
                  const next = slugDraft.replace(/^-+|-+$/g, "") || undefined;
                  setSlugDraft(next);
                  if (next !== slug) setSlug(next);
                }}
                className="min-w-0 flex-1 bg-transparent pr-2.5 text-foreground outline-none"
                aria-label="Page address"
              />
            </div>
          </label>

          <ul className="space-y-1">
            {preview.gate.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-xs">
                <Mark ok={c.ok} />
                <span>
                  <span className="text-foreground">{c.label}</span>
                  <span className="text-muted-foreground"> · {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {preview.structuredData === "mellox"
              ? "Mellox adds article and FAQ structured data to the page."
              : preview.site.provider === "wordpress"
                ? "Your theme decides the page's structured data. Install the Mellox GEO plugin to let Mellox add it."
                : "Your site's template decides the page's structured data."}
          </p>

          {preview.reason ? (
            <p
              className={cn(
                "text-xs leading-relaxed",
                preview.gate.ok ? "text-muted-foreground" : "text-danger",
              )}
            >
              {preview.reason}
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={scheduling}
                onChange={(e) => setScheduling(e.target.checked)}
              />
              Schedule for later
            </label>
            {scheduling ? (
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                aria-label="Publish at"
                className="h-9 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-foreground outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary"
              />
            ) : null}
            <Button
              className="w-full"
              loading={busy === "publish"}
              disabled={!preview.canPublish || busy !== null}
              onClick={() => void publish()}
            >
              {scheduling ? <CalendarClock className="size-4" /> : <Send className="size-4" />}
              {scheduling
                ? "Schedule"
                : preview.site.provider === "github"
                  ? "Open a pull request"
                  : `Publish to ${platform}`}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {preview.site.provider === "github"
                ? "Adds the post on a new branch for you to review and merge. Mellox then checks the live page."
                : preview.site.provider === "webflow"
                  ? "Adds the post to your Webflow blog and makes it live. Mellox then checks the live page."
                  : "Publishes the post on WordPress. Mellox then checks the live page."}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
