"use client";

import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { motion } from "framer-motion";
import { toast } from "@/lib/toast";
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  FileText,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  Link as LinkIcon,
  List,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  Video as VideoIcon,
  Wand2,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DownloadAssetButton } from "@/components/app/DownloadAssetButton";
import { CanvaEditButton } from "@/components/studio/CanvaEditButton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PlatformStack, TypeGlyph } from "@/components/studio/studio-ui";
import { openItemOrJob } from "@/hooks/use-studio";
import { supabase } from "@/integrations/supabase/client";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import { normalizeLibraryAsset, type LibraryAsset } from "@/lib/library";
import { isNewSince, parseRatio } from "@/lib/library-grid";
import { getSignedAssetUrls } from "@/lib/persistent-assets";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import {
  CONTENT_COLUMNS,
  STATUS_BADGE,
  ago,
  groupRows,
  matchesStage,
  type ContentRow,
  type Group,
  type StageFilter,
} from "@/lib/studio/content-groups";
import {
  STUDIO_FORMATS,
  STUDIO_TYPE_ORDER,
  isStudioType,
  type StudioType,
} from "@/lib/studio/formats";
import { openComposer, openJob } from "@/lib/studio/session-store";
import type { Reaction, TasteView } from "@/lib/taste/contracts";
import { LibraryTile, type TileAction } from "./library/LibraryTile";
import { Masonry } from "./library/Masonry";
import { TasteStrip } from "./library/TasteStrip";
import { useLibraryTaste, type ReactTarget } from "./library/useLibraryTaste";

type LibraryApiAsset = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  postId?: string | null;
  status: string;
  platform: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
};

/** A library picture or clip, with the post it belongs to (if any). */
type Media = LibraryAsset & { postId?: string | null };

export type LibraryTab = "all" | "posts" | "media" | "loved";
type StatusFilter = "all" | StageFilter;
type Sort = "newest" | "oldest";
type View = "grid" | "list";

type Item =
  | { kind: "post"; key: string; subject: string; createdAt: string; title: string; group: Group }
  | { kind: "media"; key: string; subject: string; createdAt: string; title: string; asset: Media };

const TONE_BADGE = {
  warn: "bg-warning-surface text-warning ring-warning-border",
  ok: "bg-success-surface text-success ring-success-border",
  danger: "bg-danger-surface text-danger ring-danger-border",
  muted: "bg-surface-2 text-muted-foreground ring-border",
} as const;

const STATUS_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Any status" },
  { id: "review", label: "Needs approval" },
  { id: "ready", label: "Ready to post" },
  { id: "scheduled", label: "Scheduled" },
  { id: "scheduled-published", label: "Scheduled & Published" },
  { id: "published", label: "Published" },
];

const SELECT =
  "h-9 rounded-full border-0 bg-surface-2/80 pl-3 pr-8 text-xs font-medium text-foreground ring-1 ring-border/60 outline-none focus-visible:ring-2 focus-visible:ring-ring/55";

const SEEN_KEY = "library:last-seen";

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

function dayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/** The workspace this library belongs to (from the route). */
function useWorkspaceId(): string | null {
  return useOptionalWorkspaceId();
}

/** When this browser last opened the Library, read once; "now" is saved for next time. */
function useLastSeen(workspaceId: string | null, fixtures: boolean): string | null {
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    if (fixtures) return;
    const key = `${SEEN_KEY}:${workspaceId ?? "none"}`;
    try {
      setSeen(localStorage.getItem(key));
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      /* private window: everything from today counts as new */
    }
  }, [workspaceId, fixtures]);
  return seen;
}

async function shareFile(url: string, name: string) {
  try {
    if (typeof navigator.canShare === "function") {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied", { description: "The link expires after a while." });
  } catch {
    toast.error("Couldn't share");
  }
}

/**
 * Everything created in Studio, in one place: every post in every format and
 * status until it's discarded, and the images and video behind them, each at
 * its true shape. A heart teaches Mellox what this brand loves (ADR-0038).
 * Rendered inside the Library pop-up (LibraryDialog).
 */
export function LibraryPage({
  initialTab = "all",
  initialStatus,
  onClose,
  backRef,
  fixtureGroups,
  fixtureThumbs,
  fixtureAssets,
  fixtureTaste,
  fixtureLastSeen,
}: {
  initialTab?: LibraryTab;
  /** Preselect a pipeline stage (from the Studio rail). */
  initialStatus?: StageFilter;
  /** Close the surrounding pop-up. */
  onClose?: () => void;
  /** Lets the pop-up ask "go back one level?" on Escape; returns true when handled. */
  backRef?: MutableRefObject<(() => boolean) | null>;
  /** Preview/testing: render these instead of querying. */
  fixtureGroups?: Group[];
  fixtureThumbs?: Record<string, string>;
  fixtureAssets?: Media[];
  fixtureTaste?: TasteView & { onChange?: (label: string) => void };
  fixtureLastSeen?: string;
} = {}) {
  const workspaceId = useWorkspaceId();
  const fixtures = !!fixtureGroups || !!fixtureAssets;
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [assets, setAssets] = useState<Media[]>(fixtureAssets ?? []);
  const [groups, setGroups] = useState<Group[]>(fixtureGroups ?? []);
  const [thumbs, setThumbs] = useState<Record<string, string>>(fixtureThumbs ?? {});
  const [loading, setLoading] = useState(!fixtures);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<StudioType | "all">("all");
  const [status, setStatus] = useState<StatusFilter>(initialStatus ?? "all");
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<View>("grid");
  const [selected, setSelected] = useState<Item | null>(null);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const loadVersion = useRef(0);
  const taste = useLibraryTaste(fixtures ? null : workspaceId, fixtureTaste);
  const storedSeen = useLastSeen(workspaceId, fixtures);
  const lastSeen = fixtureLastSeen ?? storedSeen;

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => setStatus(initialStatus ?? "all"), [initialStatus]);

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
    const version = ++loadVersion.current;
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
      if (version !== loadVersion.current) return;
      setAssets(
        (payload.assets ?? []).map((asset) => ({
          ...normalizeLibraryAsset({
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
          thumbnailUrl: asset.thumbnailUrl ?? asset.url,
          postId: asset.postId ?? null,
        })),
      );
      const rows = (posts.data ?? []) as ContentRow[];
      setGroups(groupRows(rows));
      const paths = [
        ...new Set(
          rows
            .map((r) => r.meta?.asset_storage_path)
            .filter((p): p is string => isWorkspaceStoragePath(p, workspaceId)),
        ),
      ];
      const signed = paths.length ? await getSignedAssetUrls(workspaceId, paths) : {};
      if (version !== loadVersion.current) return;
      setThumbs(signed);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      console.error("Library query failed", cause);
      setError(cause instanceof Error ? cause.message : "The request failed.");
    }
    setLoading(false);
  }, [workspaceId, fixtures]);

  useEffect(() => {
    if (!fixtures) {
      setAssets([]);
      setGroups([]);
      setThumbs({});
      setSelected(null);
    }
    void load();
    const refresh = () => void load();
    addAppEventListener("assets:changed", refresh);
    addAppEventListener("content:changed", refresh);
    const timer = fixtures ? null : window.setInterval(refresh, 45 * 60_000);
    if (!fixtures) window.addEventListener("focus", refresh);
    return () => {
      loadVersion.current++;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      removeAppEventListener("assets:changed", refresh);
      removeAppEventListener("content:changed", refresh);
    };
  }, [load, fixtures]);

  // Which post each content row belongs to, and each post's picture asset.
  const postKeyOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) for (const id of g.ids) map.set(id, g.key);
    return map;
  }, [groups]);
  const pictureOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assets) {
      const key = a.postId ? postKeyOf.get(a.postId) : undefined;
      if (key && mediaKind(a) === "image" && !map.has(key)) map.set(key, a.id);
    }
    return map;
  }, [assets, postKeyOf]);

  const presentFormats = useMemo(
    () => STUDIO_TYPE_ORDER.filter((t) => groups.some((g) => g.type === t)),
    [groups],
  );
  const images = assets.filter((a) => mediaKind(a) === "image").length;
  const videos = assets.length - images;
  const filtering = !!query.trim() || format !== "all" || status !== "all";
  const lovedCount = Object.values(taste.reactions).filter((r) => r === "love").length;

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const loved = (subject: string) => taste.reactions[subject] === "love";
    const posts: Item[] =
      tab === "media"
        ? []
        : groups
            .filter((g) => format === "all" || g.type === format)
            .filter((g) => status === "all" || matchesStage(g.stage, status))
            .filter(
              (g) => !q || g.title.toLowerCase().includes(q) || g.excerpt.toLowerCase().includes(q),
            )
            .filter((g) => tab !== "loved" || loved(g.key))
            .map((g) => ({
              kind: "post",
              key: `p-${g.key}`,
              subject: g.key,
              createdAt: g.createdAt,
              title: g.title,
              group: g,
            }));
    const media: Item[] =
      tab === "posts" || status !== "all"
        ? []
        : assets
            // A post's own picture is shown once, as the post (except under Media).
            .filter((a) => tab === "media" || !(a.postId && postKeyOf.has(a.postId)))
            .filter((a) => format === "all" || mediaStudioType(a) === format)
            .filter((a) => !q || a.name.toLowerCase().includes(q))
            .map((a) => {
              const subject = (a.postId && postKeyOf.get(a.postId)) || a.id;
              return {
                kind: "media" as const,
                key: `m-${a.id}`,
                subject,
                createdAt: a.createdAt ?? "",
                title: a.name,
                asset: a,
              };
            })
            .filter((m) => tab !== "loved" || loved(m.subject));
    const list = [...posts, ...media];
    return list.sort((a, b) =>
      sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
  }, [groups, assets, tab, query, format, status, sort, postKeyOf, taste.reactions]);

  const tabs: { id: LibraryTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: groups.length + assets.length },
    { id: "posts", label: "Posts", count: groups.length },
    { id: "media", label: "Media", count: assets.length },
    ...(taste.available ? [{ id: "loved" as const, label: "Loved", count: lovedCount }] : []),
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

  const makeMore = (type: StudioType | null, pictureId: string | null, video: boolean) => {
    onClose?.();
    if (pictureId && !video)
      emitAppEvent("open:canvas", {
        type: type ?? "social",
        referenceAssetIds: [pictureId],
        referenceMode: "inspire",
      });
    else openComposer({ type: type ?? (video ? "video" : "image") });
  };

  const copyCaption = async (group: Group) => {
    let text = group.excerpt || group.title;
    if (!fixtures) {
      const { data } = await supabase
        .from("content_items")
        .select("body")
        .in("id", group.ids)
        .limit(1)
        .maybeSingle();
      if (data?.body) text = data.body;
    }
    navigator.clipboard.writeText(text).then(
      () => toast.success("Caption copied"),
      () => toast.error("Couldn't copy"),
    );
  };

  const target = (item: Item): ReactTarget =>
    item.kind === "post"
      ? { key: item.subject, contentItemId: item.group.ids[0] }
      : { key: item.subject, assetId: item.asset.id };

  const ratioOf = useCallback(
    (item: Item): number => {
      const seen = measured[item.key];
      if (seen) return seen;
      if (item.kind === "post") {
        const g = item.group;
        const thumb = g.storagePath ? thumbs[g.storagePath] : undefined;
        return parseRatio(g.ratio) ?? (thumb ? 1 : 0.8);
      }
      const a = item.asset;
      return (
        parseRatio(a.metadata?.aspect_ratio) ??
        (a.width && a.height ? a.width / a.height : null) ??
        (mediaKind(a) === "video" ? 9 / 16 : 1)
      );
    },
    [measured, thumbs],
  );

  const keyOf = useCallback((item: Item) => item.key, []);

  const measure = (key: string, ratio: number) =>
    setMeasured((m) => (m[key] && Math.abs(m[key] - ratio) < 0.01 ? m : { ...m, [key]: ratio }));

  const renderTile = (item: Item) => {
    const reaction = taste.available ? (taste.reactions[item.subject] ?? null) : undefined;
    const react = (next: Reaction | null) => taste.react(target(item), next);
    const isNew = isNewSince(item.createdAt, lastSeen);
    if (item.kind === "post") {
      const g = item.group;
      const legacy = g.type === "legacy";
      const type = (legacy ? "article" : g.type) as StudioType;
      const thumb = g.storagePath ? thumbs[g.storagePath] : undefined;
      const badge = STATUS_BADGE[g.status];
      const picture = pictureOf.get(g.key) ?? null;
      const actions: TileAction[] = [
        { id: "open", label: "Open in Studio", icon: Wand2, onSelect: () => openInStudio(g) },
        ...(!legacy
          ? [
              {
                id: "more",
                label: "Make more like this",
                icon: Sparkles,
                onSelect: () => makeMore(type, picture, g.mediaType === "video"),
              },
            ]
          : []),
        { id: "copy", label: "Copy caption", icon: Copy, onSelect: () => void copyCaption(g) },
      ];
      return (
        <LibraryTile
          openLabel={`Open content: ${g.title}`}
          src={thumb}
          kind={thumb ? (g.mediaType === "video" ? "video" : "image") : "text"}
          ratio={ratioOf(item)}
          excerpt={g.excerpt || g.title}
          type={type}
          flag={
            badge && (badge.tone === "warn" || badge.tone === "danger")
              ? { label: badge.label, tone: badge.tone }
              : null
          }
          isNew={isNew}
          reaction={reaction}
          downloadName={`mellox-${g.mediaType ?? "asset"}-${dayStamp()}`}
          actions={actions}
          onOpen={() => setSelected(item)}
          onReact={react}
          onShare={thumb ? () => void shareFile(thumb, `mellox-${dayStamp()}`) : undefined}
          onMeasured={(r) => measure(item.key, r)}
          footer={
            <div className="px-1 pb-1 pt-2">
              <p className="truncate text-[13px] font-medium leading-snug text-foreground">
                {g.title}
              </p>
              <p
                data-testid="library-post-meta"
                className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span className="truncate">
                  {legacy ? (g.legacyLabel ?? "Content") : STUDIO_FORMATS[type].label}
                </span>
                {g.platforms.length ? <PlatformStack platforms={g.platforms} size={14} /> : null}
                <span className="ml-auto shrink-0 tabular-nums">{ago(g.createdAt)}</span>
              </p>
            </div>
          }
        />
      );
    }
    const a = item.asset;
    const kind = mediaKind(a);
    return (
      <LibraryTile
        openLabel={`Open ${kind}: ${a.name}`}
        src={a.url}
        kind={kind}
        ratio={ratioOf(item)}
        isNew={isNew}
        reaction={reaction}
        downloadName={`mellox-${kind}-${dayStamp()}`}
        mimeType={a.mimeType}
        actions={[
          {
            id: "more",
            label: "Make more like this",
            icon: Sparkles,
            onSelect: () => makeMore(mediaStudioType(a), a.id, kind === "video"),
          },
        ]}
        onOpen={() => setSelected(item)}
        onReact={react}
        onShare={a.url ? () => void shareFile(a.url!, `mellox-${kind}-${dayStamp()}`) : undefined}
        onMeasured={(r) => measure(item.key, r)}
        footer={
          <p className="flex items-center gap-1.5 px-1 pb-1 pt-2 text-[11px] text-muted-foreground">
            {kind === "video" ? <VideoIcon className="size-3" /> : <ImageIcon className="size-3" />}
            {kind === "video" ? "Video" : "Image"}
            {a.createdAt ? <span className="ml-auto tabular-nums">{ago(a.createdAt)}</span> : null}
          </p>
        }
      />
    );
  };

  const summary = [
    `${groups.length} post${groups.length === 1 ? "" : "s"}`,
    `${images} image${images === 1 ? "" : "s"}`,
    ...(videos ? [`${videos} video${videos === 1 ? "" : "s"}`] : []),
  ].join(" · ");

  const selectedReaction =
    selected && taste.available ? (taste.reactions[selected.subject] ?? null) : undefined;

  return (
    <div className="@container/library flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* ── Header ── */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/50 bg-background/60 px-3 backdrop-blur-xl @3xl/library:px-5">
        {/* Back only when drilled into an item; the X closes the window. */}
        {selected ? (
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-label="Back to library"
            title="Back to library"
            className="grid size-9 shrink-0 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : null}
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20"
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
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">
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
            emitAppEvent("open:create-launcher");
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
              reaction={selectedReaction}
              onReact={(next) => taste.react(target(selected), next)}
            />
          ) : (
            <MediaDetail
              asset={selected.asset}
              onCreate={() => {
                onClose?.();
                openComposer({ type: mediaKind(selected.asset) === "video" ? "video" : "image" });
              }}
              reaction={selectedReaction}
              onReact={(next) => taste.react(target(selected), next)}
            />
          )}
        </div>
      ) : (
        <>
          {/* ── Toolbar ── */}
          <div className="shrink-0 border-b border-border/50 px-3 py-3 @3xl/library:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="Library filter"
                className="inline-flex max-w-full overflow-x-auto rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60 [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden"
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
                        "relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs @md/library:px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
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
                      {t.id === "loved" ? (
                        <Heart
                          className={cn(
                            "relative size-3.5",
                            on ? "fill-primary text-primary" : "text-current",
                          )}
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
                <Search className="pointer-events-none absolute z-10 left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
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

              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
                {presentFormats.length > 1 ? (
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as StudioType | "all")}
                    aria-label="Format"
                    className={SELECT}
                  >
                    <option value="all">All creatives</option>
                    {presentFormats.map((f) => (
                      <option key={f} value={f}>
                        {STUDIO_FORMATS[f].label}
                      </option>
                    ))}
                  </select>
                ) : null}
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
          </div>

          {/* ── Results ── */}
          <main className="min-h-0 flex-1 overflow-y-auto p-3 @3xl/library:p-5">
            {taste.available && taste.summary && !loading && !error ? (
              <div className="mb-3">
                <TasteStrip
                  summary={taste.summary}
                  onShowLoved={() => setTab("loved")}
                  onReset={taste.reset}
                />
              </div>
            ) : null}
            {loading ? (
              <div className="columns-2 gap-3 @2xl/library:columns-3 @4xl/library:columns-4 @6xl/library:columns-5">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div
                    key={index}
                    className="relative mb-3 overflow-hidden rounded-[20px] bg-surface-2 ring-1 ring-border/60"
                    style={{ aspectRatio: String([0.8, 1, 0.5625, 1.25, 0.8][index % 5]) }}
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
              tab === "loved" && !filtering ? (
                <EmptyState
                  icon={Heart}
                  title="Nothing loved yet"
                  description="Tap ♥ on a post you love. Mellox makes more like it."
                  action={
                    <Button variant="outline" onClick={() => setTab("all")}>
                      See everything
                    </Button>
                  }
                />
              ) : filtering ? (
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
                        emitAppEvent("open:create-launcher");
                      }}
                    >
                      <Sparkles className="size-4" />
                      Create something
                    </Button>
                  }
                />
              )
            ) : view === "grid" ? (
              <Masonry
                key={tab}
                testId="library-grid"
                items={items}
                keyOf={keyOf}
                ratioOf={ratioOf}
                render={renderTile}
              />
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
                      loved={taste.reactions[item.subject] === "love"}
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

function ListRow({
  item,
  thumb,
  loved,
  onOpen,
}: {
  item: Item;
  thumb?: string;
  loved?: boolean;
  onOpen: () => void;
}) {
  const isPost = item.kind === "post";
  const type: StudioType | null = isPost
    ? item.group.type === "legacy"
      ? "article"
      : item.group.type
    : mediaStudioType(item.asset);
  const kind = isPost ? item.group.mediaType : mediaKind(item.asset);
  const downloadName = `mellox-${isPost ? (item.group.mediaType ?? "asset") : kind}-${dayStamp()}`;
  return (
    <div className="relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-surface-2/70">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${isPost ? "content" : kind}: ${item.title}`}
        className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
      />
      <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border/60">
        {thumb && kind === "image" ? (
          <img src={thumb} alt="" loading="lazy" className="size-full object-contain" />
        ) : thumb && kind === "video" ? (
          <video src={thumb} muted preload="metadata" className="size-full object-contain" />
        ) : type ? (
          <TypeGlyph type={type} />
        ) : (
          <FileText className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="truncate">{item.title}</span>
          {loved ? (
            <Heart aria-label="Loved" className="size-3.5 shrink-0 fill-primary text-primary" />
          ) : null}
        </span>
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
      <DownloadAssetButton
        url={thumb}
        filename={downloadName}
        mimeType={isPost ? undefined : item.asset.mimeType}
        compact
        className="relative z-20 shrink-0"
      />
    </div>
  );
}

/** Love and "less like this" in a detail view. Hidden when hearts are off. */
function ReactButtons({
  reaction,
  onReact,
}: {
  reaction: Reaction | null | undefined;
  onReact: (next: Reaction | null) => void;
}) {
  if (reaction === undefined) return null;
  const loved = reaction === "love";
  const less = reaction === "less";
  return (
    <>
      <Button
        variant={loved ? "default" : "outline"}
        aria-pressed={loved}
        onClick={() => onReact(loved ? null : "love")}
      >
        <Heart className={cn(loved && "fill-current")} />
        {loved ? "Loved" : "Love"}
      </Button>
      <Button variant="ghost" onClick={() => onReact(less ? null : "less")}>
        {less ? <RotateCcw /> : <ThumbsDown />}
        {less ? "Show more like this" : "Less like this"}
      </Button>
    </>
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
  reaction,
  onReact,
}: {
  group: Group;
  thumb?: string;
  fixtures: boolean;
  onOpen: () => void;
  reaction?: Reaction | null;
  onReact: (next: Reaction | null) => void;
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
          <ReactButtons reaction={reaction} onReact={onReact} />
          <Button variant="outline" onClick={copy} disabled={rows === null}>
            <Copy />
            Copy caption
          </Button>
          {thumb ? (
            <DownloadAssetButton
              url={thumb}
              filename={`mellox-${group.mediaType ?? "asset"}-${dayStamp()}`}
            >
              Download {group.mediaType === "video" ? "video" : "image"}
            </DownloadAssetButton>
          ) : null}
          {thumb && group.mediaType !== "video" && group.ids[0] ? (
            <CanvaEditButton contentId={group.ids[0]} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MediaDetail({
  asset,
  onCreate,
  reaction,
  onReact,
}: {
  asset: LibraryAsset;
  onCreate: () => void;
  reaction?: Reaction | null;
  onReact: (next: Reaction | null) => void;
}) {
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
          <dd className="text-foreground">
            {asset.metadata?.source === "ugc" ? "Creator video ad" : "Made in Studio"}
          </dd>
        </dl>

        <div className="mt-6 flex flex-wrap gap-2">
          <ReactButtons reaction={reaction} onReact={onReact} />
          {kind === "image" &&
          asset.source === "generated" &&
          asset.status === "ready" &&
          asset.url ? (
            <CanvaEditButton assetId={asset.id} />
          ) : null}
          {asset.url ? (
            <DownloadAssetButton
              url={asset.url}
              filename={`mellox-${kind}-${dayStamp()}`}
              mimeType={asset.mimeType}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            />
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
