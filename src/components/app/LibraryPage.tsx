"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Link as LinkIcon,
  List,
  RefreshCw,
  Search,
  Sparkles,
  Video as VideoIcon,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PlatformStack, TypeGlyph } from "@/components/studio/studio-ui";
import { openItemOrJob } from "@/hooks/use-studio";
import { supabase } from "@/integrations/supabase/client";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { authedFetch, getActiveWorkspaceId } from "@/lib/authed-fetch";
import { normalizeLibraryAsset, type LibraryAsset } from "@/lib/library";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import {
  CONTENT_COLUMNS,
  STATUS_BADGE,
  ago,
  groupRows,
  type ContentRow,
  type Group,
} from "@/lib/studio/content-groups";
import {
  STUDIO_FORMATS,
  STUDIO_TYPE_ORDER,
  isStudioType,
  type StudioType,
} from "@/lib/studio/formats";
import { openComposer, openJob } from "@/lib/studio/session-store";

type LibraryApiAsset = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  status: string;
  platform: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
};

export type LibraryTab = "all" | "posts" | "media";
type StatusFilter = "all" | "review" | "ready" | "scheduled" | "published";
type Sort = "newest" | "oldest";
type View = "grid" | "list";

type Item =
  | { kind: "post"; key: string; createdAt: string; title: string; group: Group }
  | { kind: "media"; key: string; createdAt: string; title: string; asset: LibraryAsset };

const TONE_BADGE = {
  warn: "bg-warning-surface text-warning ring-warning-border",
  ok: "bg-success-surface text-success ring-success-border",
  danger: "bg-danger-surface text-danger ring-danger-border",
  muted: "bg-surface-2 text-muted-foreground ring-border",
} as const;

const STATUS_GROUP: Record<string, StatusFilter> = {
  draft: "review",
  pending: "review",
  failed: "review",
  approved: "ready",
  scheduled: "scheduled",
  publishing: "published",
  published: "published",
  partial_failed: "published",
};

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Any status" },
  { id: "review", label: "Needs approval" },
  { id: "ready", label: "Ready to post" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
];

const SELECT =
  "h-9 rounded-full border-0 bg-surface-2/80 pl-3 pr-8 text-xs font-medium text-foreground ring-1 ring-border/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/55";

function mediaKind(asset: LibraryAsset): "image" | "video" {
  return asset.type === "video" ? "video" : "image";
}

function mediaStudioType(asset: LibraryAsset): StudioType | null {
  const t = asset.metadata?.studio_type;
  return isStudioType(t) ? t : null;
}

function fullDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** Workspace id that follows the switcher. */
function useWorkspaceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setId(getActiveWorkspaceId());
    sync();
    addAppEventListener("workspace:changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      removeAppEventListener("workspace:changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return id;
}

/**
 * Everything created in Studio, in one place: every post in every format and
 * status until it's discarded, and the images and video behind them. Search,
 * filter, and open anything to read its captions, copy, download, or pick it
 * back up in Studio. Rendered inside the Library pop-up (LibraryDialog).
 */
export function LibraryPage({
  initialTab = "all",
  onClose,
  backRef,
  fixtureGroups,
  fixtureThumbs,
  fixtureAssets,
}: {
  initialTab?: LibraryTab;
  /** Close the surrounding pop-up. */
  onClose?: () => void;
  /** Lets the pop-up ask "go back one level?" on Escape; returns true when handled. */
  backRef?: MutableRefObject<(() => boolean) | null>;
  /** Preview/testing: render these instead of querying. */
  fixtureGroups?: Group[];
  fixtureThumbs?: Record<string, string>;
  fixtureAssets?: LibraryAsset[];
} = {}) {
  const workspaceId = useWorkspaceId();
  const reduce = useReducedMotion();
  const fixtures = !!fixtureGroups || !!fixtureAssets;
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [assets, setAssets] = useState<LibraryAsset[]>(fixtureAssets ?? []);
  const [groups, setGroups] = useState<Group[]>(fixtureGroups ?? []);
  const [thumbs, setThumbs] = useState<Record<string, string>>(fixtureThumbs ?? {});
  const [loading, setLoading] = useState(!fixtures);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<StudioType | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<View>("grid");
  const [selected, setSelected] = useState<Item | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    try {
      if (localStorage.getItem("library:view") === "list") setView("list");
    } catch {
      /* ignore */
    }
  }, []);

  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem("library:view", next);
    } catch {
      /* ignore */
    }
  };

  // Escape inside the pop-up steps back from a detail view before closing.
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (!selected) return false;
      setSelected(null);
      return true;
    };
    return () => {
      backRef.current = null;
    };
  }, [backRef, selected]);

  // "/" jumps to search.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      setSelected(null);
      window.requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const load = useCallback(async () => {
    if (fixtures) return;
    if (!workspaceId) {
      setAssets([]);
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [assetRes, posts] = await Promise.all([
        authedFetch(`/api/assets/library?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
        }),
        supabase
          .from("content_items")
          .select(CONTENT_COLUMNS)
          .eq("workspace_id", workspaceId)
          .neq("status", "rejected")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const payload = (await assetRes.json().catch(() => ({}))) as {
        assets?: LibraryApiAsset[];
        error?: string;
      };
      if (!assetRes.ok) throw new Error(payload.error || "Could not load your library");
      if (posts.error) throw new Error(posts.error.message);
      setAssets(
        (payload.assets ?? []).map((asset) =>
          normalizeLibraryAsset({
            id: asset.id,
            title: asset.name,
            media_url: asset.url,
            kind: asset.type,
            status: asset.status,
            created_at: asset.createdAt,
            updated_at: asset.updatedAt,
            workspace_id: asset.workspaceId,
            channel: asset.platform,
            mime_type: asset.mimeType,
            metadata: asset.metadata,
            source: "generated",
          }),
        ),
      );
      const rows = (posts.data ?? []) as ContentRow[];
      setGroups(groupRows(rows));
      const paths = [
        ...new Set(
          rows
            .map((r) => r.meta?.asset_storage_path)
            .filter((p): p is string => typeof p === "string"),
        ),
      ];
      if (paths.length) {
        const { data } = await supabase.storage
          .from("generated-assets")
          .createSignedUrls(paths, 3600);
        const next: Record<string, string> = {};
        for (const s of data ?? []) if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        setThumbs(next);
      }
    } catch (cause) {
      console.error("Library query failed", cause);
      setError(cause instanceof Error ? cause.message : "The request failed.");
    }
    setLoading(false);
  }, [workspaceId, fixtures]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    addAppEventListener("assets:changed", refresh);
    addAppEventListener("content:changed", refresh);
    return () => {
      removeAppEventListener("assets:changed", refresh);
      removeAppEventListener("content:changed", refresh);
    };
  }, [load]);

  const presentFormats = useMemo(
    () => STUDIO_TYPE_ORDER.filter((t) => groups.some((g) => g.type === t)),
    [groups],
  );
  const images = assets.filter((a) => mediaKind(a) === "image").length;
  const videos = assets.length - images;
  const filtering = !!query.trim() || format !== "all" || status !== "all";

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const posts: Item[] =
      tab === "media"
        ? []
        : groups
            .filter((g) => format === "all" || g.type === format)
            .filter((g) => status === "all" || STATUS_GROUP[g.status] === status)
            .filter(
              (g) => !q || g.title.toLowerCase().includes(q) || g.excerpt.toLowerCase().includes(q),
            )
            .map((g) => ({
              kind: "post",
              key: `p-${g.key}`,
              createdAt: g.createdAt,
              title: g.title,
              group: g,
            }));
    const media: Item[] =
      tab === "posts" || status !== "all"
        ? []
        : assets
            .filter((a) => format === "all" || mediaStudioType(a) === format)
            .filter((a) => !q || a.name.toLowerCase().includes(q))
            .map((a) => ({
              kind: "media",
              key: `m-${a.id}`,
              createdAt: a.createdAt ?? "",
              title: a.name,
              asset: a,
            }));
    const list = [...posts, ...media];
    return list.sort((a, b) =>
      sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
  }, [groups, assets, tab, query, format, status, sort]);

  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: groups.length + assets.length },
    { id: "posts", label: "Posts", count: groups.length },
    { id: "media", label: "Media", count: assets.length },
  ];

  const clearFilters = () => {
    setQuery("");
    setFormat("all");
    setStatus("all");
  };

  const openInStudio = (group: Group) => {
    onClose?.();
    if (group.jobId) void openJob(group.jobId);
    else void openItemOrJob(group.ids[0]);
  };

  const summary = [
    `${groups.length} post${groups.length === 1 ? "" : "s"}`,
    `${images} image${images === 1 ? "" : "s"}`,
    ...(videos ? [`${videos} video${videos === 1 ? "" : "s"}`] : []),
  ].join(" · ");

  return (
    <div className="@container/library flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3 @3xl/library:px-5">
        {onClose || selected ? (
          <button
            type="button"
            onClick={() => (selected ? setSelected(null) : onClose?.())}
            aria-label={selected ? "Back to library" : "Close library"}
            title={selected ? "Back to library" : "Back"}
            className="grid size-9 shrink-0 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-surface text-primary ring-1 ring-primary-border"
        >
          <LayoutGrid className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {selected ? (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="hover:text-foreground hover:underline"
              >
                Library
              </button>
              <span aria-hidden>/</span>
              <span>{selected.kind === "post" ? "Posts" : "Media"}</span>
            </p>
          ) : null}
          <h1 className="truncate text-base font-semibold leading-tight tracking-tight">
            {selected ? selected.title : "Library"}
          </h1>
          {!selected ? (
            <p className="truncate text-xs text-muted-foreground">
              {loading ? "Loading…" : summary}
            </p>
          ) : null}
        </div>
        {!selected ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={() => void load()}
            disabled={loading || fixtures}
            aria-label="Refresh library"
            title="Refresh"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        ) : null}
        <Button
          size="sm"
          className="studio-cta hidden rounded-full @2xl/library:inline-flex"
          onClick={() => {
            onClose?.();
            openComposer();
          }}
        >
          <Wand2 />
          Create
        </Button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            title="Close (Esc)"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      {selected ? (
        <div key={selected.key} className="studio-enter-blur min-h-0 flex-1 overflow-y-auto">
          {selected.kind === "post" ? (
            <PostDetail
              group={selected.group}
              thumb={selected.group.storagePath ? thumbs[selected.group.storagePath] : undefined}
              fixtures={fixtures}
              onOpen={() => openInStudio(selected.group)}
            />
          ) : (
            <MediaDetail
              asset={selected.asset}
              onCreate={() => {
                onClose?.();
                openComposer({ type: mediaKind(selected.asset) === "video" ? "video" : "image" });
              }}
            />
          )}
        </div>
      ) : (
        <>
          {/* ── Toolbar ── */}
          <div className="shrink-0 space-y-2.5 border-b border-border/50 px-3 py-3 @3xl/library:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Library filter"
                className="inline-flex rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60"
              >
                {tabs.map((t) => {
                  const on = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "relative inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                        on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {on ? (
                        <motion.span
                          layoutId="library-tab"
                          className="absolute inset-0 rounded-full bg-surface-3 shadow-1 ring-1 ring-border/70"
                          transition={{ duration: duration.medium, ease: ease.emphasized }}
                        />
                      ) : null}
                      <span className="relative">{t.label}</span>
                      {!loading ? (
                        <span className="relative tabular-nums text-muted-foreground">
                          {t.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <label className="relative order-last flex h-9 min-w-0 basis-full items-center @2xl/library:order-none @2xl/library:basis-auto @2xl/library:flex-1">
                <Search className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
                <span className="sr-only">Search the library</span>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search titles and captions"
                  className="h-9 w-full rounded-full border-0 bg-surface-2/80 pl-8 pr-9 text-sm text-foreground ring-1 ring-border/60 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/55"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-1.5 grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-3 hidden rounded bg-surface-3 px-1.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border @2xl/library:inline">
                    /
                  </kbd>
                )}
              </label>

              <div className="ml-auto flex items-center gap-2">
                {tab !== "media" ? (
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusFilter)}
                    aria-label="Status"
                    className={SELECT}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  aria-label="Sort"
                  className={SELECT}
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
                <div
                  role="radiogroup"
                  aria-label="View"
                  className="inline-flex rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60"
                >
                  {(
                    [
                      { id: "grid", icon: LayoutGrid, label: "Grid" },
                      { id: "list", icon: List, label: "List" },
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={view === v.id}
                      aria-label={`${v.label} view`}
                      title={`${v.label} view`}
                      onClick={() => changeView(v.id)}
                      className={cn(
                        "grid size-7 place-items-center rounded-full transition-colors",
                        view === v.id
                          ? "bg-surface-3 text-foreground shadow-1 ring-1 ring-border/70"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <v.icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {presentFormats.length > 1 ? (
              <div
                role="radiogroup"
                aria-label="Format"
                className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {(["all", ...presentFormats] as const).map((f) => {
                  const on = format === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setFormat(f)}
                      className={cn(
                        f === "all" ? "" : `studio-tone-${f}`,
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 transition-colors",
                        on
                          ? f === "all"
                            ? "bg-foreground text-background ring-foreground"
                            : "bg-[hsl(var(--tone)/0.14)] text-foreground ring-[hsl(var(--tone)/0.45)]"
                          : "bg-surface-3 text-muted-foreground ring-border/70 hover:text-foreground",
                      )}
                    >
                      {f === "all" ? (
                        "All formats"
                      ) : (
                        <>
                          <TypeGlyph type={f} size="sm" className="size-5 [&_svg]:size-3" />
                          {STUDIO_FORMATS[f].label}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* ── Results ── */}
          <main className="min-h-0 flex-1 overflow-y-auto p-3 @3xl/library:p-5">
            {loading ? (
              <div className="grid grid-cols-2 gap-3 @2xl/library:grid-cols-3 @4xl/library:grid-cols-4 @6xl/library:grid-cols-5">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div
                    key={index}
                    className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border/60"
                  >
                    <span className="studio-weave absolute inset-0" aria-hidden />
                  </div>
                ))}
              </div>
            ) : error ? (
              <ErrorState
                title="Couldn't load your library"
                description="Your work is still there. This was a problem fetching it."
                detail={error}
                onRetry={() => void load()}
              />
            ) : items.length === 0 ? (
              filtering ? (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  description="Nothing in your library matches these filters."
                  action={
                    <Button variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={tab === "media" ? ImageIcon : FileText}
                  title={tab === "media" ? "No images or video yet" : "Nothing here yet"}
                  description="Everything you generate in Studio is saved here automatically."
                  action={
                    <Button
                      onClick={() => {
                        onClose?.();
                        openComposer();
                      }}
                    >
                      <Sparkles className="size-4" />
                      Create something
                    </Button>
                  }
                />
              )
            ) : view === "grid" ? (
              <ul
                key={`${tab}-grid`}
                className="grid grid-cols-2 gap-3 @2xl/library:grid-cols-3 @4xl/library:grid-cols-4 @6xl/library:grid-cols-5"
              >
                {items.map((item, i) => (
                  <motion.li
                    key={item.key}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i, 12) * 0.03,
                      duration: duration.slow,
                      ease: ease.emphasized,
                    }}
                  >
                    {item.kind === "post" ? (
                      <PostCard
                        group={item.group}
                        thumb={item.group.storagePath ? thumbs[item.group.storagePath] : undefined}
                        onOpen={() => setSelected(item)}
                      />
                    ) : (
                      <MediaCard asset={item.asset} onOpen={() => setSelected(item)} />
                    )}
                  </motion.li>
                ))}
              </ul>
            ) : (
              <ul
                key={`${tab}-list`}
                className="divide-y divide-border/60 rounded-2xl bg-surface-3 ring-1 ring-border/70"
              >
                {items.map((item) => (
                  <li key={item.key}>
                    <ListRow
                      item={item}
                      thumb={
                        item.kind === "post"
                          ? item.group.storagePath
                            ? thumbs[item.group.storagePath]
                            : undefined
                          : (item.asset.url ?? undefined)
                      }
                      onOpen={() => setSelected(item)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  const badge = STATUS_BADGE[status] ?? { label: status, tone: "muted" as const };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 backdrop-blur",
        TONE_BADGE[badge.tone],
        className,
      )}
    >
      {badge.label}
    </span>
  );
}

function PostCard({ group, thumb, onOpen }: { group: Group; thumb?: string; onOpen: () => void }) {
  const legacy = group.type === "legacy";
  const type = (legacy ? "article" : group.type) as StudioType;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        `studio-tone-${type} group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-surface-3 text-left shadow-1 ring-1 ring-border/70`,
        "transition-[box-shadow,translate] duration-[--motion-duration-base] ease-[--motion-ease-emphasized] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-18px_hsl(var(--tone)/0.5)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]",
      )}
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[hsl(var(--tone)/0.16)] to-[hsl(var(--tone)/0.04)]">
        {thumb && group.mediaType === "image" ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-[--motion-duration-xslow] group-hover:scale-[1.03]"
          />
        ) : thumb && group.mediaType === "video" ? (
          <video
            src={thumb}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex flex-col p-3.5 pt-10">
            <span className="line-clamp-4 text-[12px] leading-snug text-foreground/75">
              {group.excerpt || group.title}
            </span>
            <TypeGlyph type={type} className="mt-auto" />
          </span>
        )}
        <StatusBadge status={group.status} className="absolute left-2.5 top-2.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col p-3">
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {group.title}
        </span>
        <span className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {legacy ? (group.legacyLabel ?? "Content") : STUDIO_FORMATS[type].label}
          </span>
          {group.platforms.length ? <PlatformStack platforms={group.platforms} size={16} /> : null}
          <span className="ml-auto shrink-0 tabular-nums">{ago(group.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

function MediaCard({ asset, onOpen }: { asset: LibraryAsset; onOpen: () => void }) {
  const kind = mediaKind(asset);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${kind}: ${asset.name}`}
      className="group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-2 shadow-1 ring-1 ring-border/70 transition-[box-shadow,translate] duration-[--motion-duration-base] hover:-translate-y-0.5 hover:shadow-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
    >
      {kind === "video" && asset.url ? (
        <video
          src={asset.url}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : asset.url ? (
        <img
          src={asset.url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-[--motion-duration-xslow] group-hover:scale-[1.03]"
        />
      ) : (
        <span className="grid size-full place-items-center">
          {kind === "video" ? (
            <VideoIcon className="size-8 text-muted-foreground" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" />
          )}
        </span>
      )}
      <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
        {kind === "video" ? <VideoIcon className="size-3" /> : <ImageIcon className="size-3" />}
        {kind === "video" ? "Video" : "Image"}
      </span>
      {asset.createdAt ? (
        <span className="absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6 text-left text-[11px] text-white opacity-0 transition-[opacity,translate] duration-[--motion-duration-base] group-hover:translate-y-0 group-hover:opacity-100">
          {ago(asset.createdAt)}
        </span>
      ) : null}
    </button>
  );
}

function ListRow({ item, thumb, onOpen }: { item: Item; thumb?: string; onOpen: () => void }) {
  const isPost = item.kind === "post";
  const type: StudioType | null = isPost
    ? item.group.type === "legacy"
      ? "article"
      : item.group.type
    : mediaStudioType(item.asset);
  const kind = isPost ? item.group.mediaType : mediaKind(item.asset);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
    >
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border/60">
        {thumb && kind === "image" ? (
          <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
        ) : thumb && kind === "video" ? (
          <video src={thumb} muted preload="metadata" className="size-full object-cover" />
        ) : type ? (
          <TypeGlyph type={type} />
        ) : (
          <FileText className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">
            {isPost
              ? item.group.type === "legacy"
                ? (item.group.legacyLabel ?? "Content")
                : STUDIO_FORMATS[item.group.type].label
              : kind === "video"
                ? "Video"
                : "Image"}
          </span>
          {isPost && item.group.platforms.length ? (
            <PlatformStack platforms={item.group.platforms} size={14} />
          ) : null}
        </span>
      </span>
      {isPost ? (
        <StatusBadge status={item.group.status} className="hidden @xl/library:inline-flex" />
      ) : null}
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {item.createdAt ? ago(item.createdAt) : ""}
      </span>
    </button>
  );
}

type Version = { id: string; platform: PlatformId | null; body: string };

const OPEN_LABEL: Record<string, string> = {
  draft: "Review in Studio",
  pending: "Review in Studio",
  failed: "Open in Studio",
  approved: "Schedule or post",
  scheduled: "View schedule",
  publishing: "View in Studio",
  published: "View in Studio",
  partial_failed: "View delivery",
};

function PostDetail({
  group,
  thumb,
  fixtures,
  onOpen,
}: {
  group: Group;
  thumb?: string;
  fixtures: boolean;
  onOpen: () => void;
}) {
  const legacy = group.type === "legacy";
  const type = (legacy ? "article" : group.type) as StudioType;
  const [rows, setRows] = useState<Version[] | null>(fixtures ? [] : null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (fixtures) return;
    let alive = true;
    void supabase
      .from("content_items")
      .select("id, body, meta")
      .in("id", group.ids)
      .then(({ data }) => {
        if (!alive) return;
        const list = (
          (data ?? []) as {
            id: string;
            body: string | null;
            meta: Record<string, unknown> | null;
          }[]
        ).map((r) => ({
          id: r.id,
          platform:
            typeof r.meta?.platform === "string" && r.meta.platform in PLATFORMS
              ? (r.meta.platform as PlatformId)
              : null,
          body: r.body ?? "",
        }));
        setRows(list);
      });
    return () => {
      alive = false;
    };
  }, [group.ids, fixtures]);

  const versions: Version[] =
    rows && rows.some((v) => v.body.trim())
      ? rows.filter((v) => v.body.trim())
      : [
          {
            id: "excerpt",
            platform: group.platforms[0] ?? null,
            body: group.excerpt || group.title,
          },
        ];
  const current = versions[Math.min(active, versions.length - 1)];

  const copy = () =>
    void navigator.clipboard.writeText(current.body).then(
      () => toast.success("Caption copied"),
      () => toast.error("Couldn't copy"),
    );

  return (
    <div
      className={`studio-tone-${type} grid gap-5 p-4 @3xl/library:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] @3xl/library:gap-8 @3xl/library:p-6`}
    >
      <div className="studio-canvas relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl p-4 ring-1 ring-border/60 @3xl/library:min-h-[480px] @3xl/library:p-8">
        <div aria-hidden className="studio-aurora studio-aurora-soft" />
        {thumb && group.mediaType === "image" ? (
          <img
            src={thumb}
            alt=""
            className="relative max-h-[62vh] max-w-full rounded-xl object-contain shadow-4"
          />
        ) : thumb && group.mediaType === "video" ? (
          <video
            src={thumb}
            controls
            playsInline
            className="relative max-h-[62vh] max-w-full rounded-xl bg-black shadow-4"
          />
        ) : (
          <div className="relative w-full max-w-md rounded-2xl bg-surface-3 p-6 shadow-3 ring-1 ring-border/70">
            <TypeGlyph type={type} size="lg" />
            <p className="mt-4 text-lg font-semibold leading-snug tracking-tight text-foreground">
              {group.title}
            </p>
            <p className="mt-2 line-clamp-6 text-sm leading-relaxed text-muted-foreground">
              {group.excerpt}
            </p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={group.status} />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <TypeGlyph type={type} size="sm" className="size-5 [&_svg]:size-3" />
            {legacy ? (group.legacyLabel ?? "Content") : STUDIO_FORMATS[type].label}
          </span>
        </div>
        <h2 className="mt-3 text-balance text-xl font-semibold leading-snug tracking-tight text-foreground">
          {group.title}
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground">{fullDate(group.createdAt)}</dd>
          {group.platforms.length ? (
            <>
              <dt className="text-muted-foreground">Platforms</dt>
              <dd className="flex items-center gap-2 text-foreground">
                <PlatformStack platforms={group.platforms} size={18} max={6} />
                {group.platforms.map((p) => PLATFORMS[p].label).join(", ")}
              </dd>
            </>
          ) : null}
        </dl>

        {versions.length > 1 ? (
          <div
            role="tablist"
            aria-label="Platform versions"
            className="mt-5 inline-flex w-fit flex-wrap gap-1 rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60"
          >
            {versions.map((v, i) => {
              const on = i === Math.min(active, versions.length - 1);
              const Icon = v.platform ? PLATFORMS[v.platform].icon : FileText;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(i)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    on
                      ? "bg-surface-3 text-foreground shadow-1 ring-1 ring-border/70"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {v.platform ? PLATFORMS[v.platform].label : `Version ${i + 1}`}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="relative mt-4 rounded-2xl bg-surface-3 ring-1 ring-border/70">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
            <span className="ui-eyebrow">
              {current.platform ? `${PLATFORMS[current.platform].label} caption` : "Text"}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {rows === null ? "Loading…" : `${current.body.length.toLocaleString()} characters`}
            </span>
          </div>
          <div className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed text-foreground">
            {rows === null ? (
              <span className="block space-y-2" aria-busy>
                <span className="block h-2.5 w-11/12 animate-pulse rounded-full bg-surface-2" />
                <span className="block h-2.5 w-4/5 animate-pulse rounded-full bg-surface-2" />
                <span className="block h-2.5 w-2/3 animate-pulse rounded-full bg-surface-2" />
              </span>
            ) : (
              current.body
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="studio-cta" onClick={onOpen}>
            {group.status === "approved" ? <CalendarClock /> : <Wand2 />}
            {OPEN_LABEL[group.status] ?? "Open in Studio"}
          </Button>
          <Button variant="outline" onClick={copy} disabled={rows === null}>
            <Copy />
            Copy caption
          </Button>
          {thumb ? (
            <Button variant="outline" asChild>
              <a href={thumb} download target="_blank" rel="noreferrer">
                <Download />
                Download {group.mediaType === "video" ? "video" : "image"}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MediaDetail({ asset, onCreate }: { asset: LibraryAsset; onCreate: () => void }) {
  const kind = mediaKind(asset);
  const studioType = mediaStudioType(asset);
  const ratio =
    typeof asset.metadata?.aspect_ratio === "string"
      ? asset.metadata.aspect_ratio
      : asset.width && asset.height
        ? `${asset.width} × ${asset.height}`
        : null;

  const copyLink = () => {
    if (!asset.url) return;
    void navigator.clipboard.writeText(asset.url).then(
      () => toast.success("Link copied", { description: "The link expires after a while." }),
      () => toast.error("Couldn't copy"),
    );
  };

  return (
    <div className="grid gap-5 p-4 @3xl/library:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] @3xl/library:gap-8 @3xl/library:p-6">
      <div className="studio-canvas relative flex min-h-[280px] items-center justify-center overflow-hidden rounded-2xl p-4 ring-1 ring-border/60 @3xl/library:min-h-[520px] @3xl/library:p-8">
        {kind === "video" && asset.url ? (
          <video
            src={asset.url}
            controls
            playsInline
            className="relative max-h-[66vh] max-w-full rounded-xl bg-black shadow-4"
          />
        ) : asset.url ? (
          <img
            src={asset.url}
            alt={asset.name}
            className="relative max-h-[66vh] max-w-full rounded-xl object-contain shadow-4"
          />
        ) : (
          <ImageIcon className="size-10 text-muted-foreground" />
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
          {kind === "video" ? <VideoIcon className="size-3" /> : <ImageIcon className="size-3" />}
          {kind === "video" ? "Video" : "Image"}
        </span>
        <h2 className="mt-3 break-words text-xl font-semibold leading-snug tracking-tight text-foreground">
          {asset.name}
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Created</dt>
          <dd className="text-foreground">{fullDate(asset.createdAt)}</dd>
          {ratio ? (
            <>
              <dt className="text-muted-foreground">Size</dt>
              <dd className="tabular-nums text-foreground">{ratio}</dd>
            </>
          ) : null}
          {studioType ? (
            <>
              <dt className="text-muted-foreground">Made for</dt>
              <dd className="text-foreground">{STUDIO_FORMATS[studioType].label}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Source</dt>
          <dd className="text-foreground">Generated in Studio</dd>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          {asset.url ? (
            <Button className="studio-cta" asChild>
              <a href={asset.url} download target="_blank" rel="noreferrer">
                <Download />
                Download
              </a>
            </Button>
          ) : null}
          <Button variant="outline" onClick={copyLink} disabled={!asset.url}>
            <LinkIcon />
            Copy link
          </Button>
          <Button variant="outline" onClick={onCreate}>
            <Wand2 />
            New {kind === "video" ? "video" : "image"} post
          </Button>
        </div>
      </div>
    </div>
  );
}
