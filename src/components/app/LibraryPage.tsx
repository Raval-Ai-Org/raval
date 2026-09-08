"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { normalizeLibraryAsset, type LibraryAsset, type LibraryAssetType } from "@/lib/library";
import {
  Search,
  Folder,
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  Download,
  Star,
  SlidersHorizontal,
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  List,
  MoreHorizontal,
  Upload,
  Plus,
  X,
  Play,
  ExternalLink,
  Trash2,
} from "@/components/ui/gemini-icons";
import { toast } from "sonner";

const tabs = [
  { id: "all", label: "All" },
  { id: "images", label: "Images" },
  { id: "videos", label: "Videos" },
  { id: "files", label: "Files" },
  { id: "brand-assets", label: "Brand Assets" },
  { id: "downloads", label: "Downloads" },
] as const;

type TabId = (typeof tabs)[number]["id"];
type SortMode = "newest" | "oldest" | "updated" | "az" | "za";
type ViewMode = "grid" | "list";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "ready" | "failed";
};

const tabTypeMap: Record<TabId, LibraryAssetType | "all" | "brand" | "download"> = {
  all: "all",
  images: "image",
  videos: "video",
  files: "file",
  "brand-assets": "brand",
  downloads: "download",
};

export function LibraryPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<UploadItem[]>([]);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const id = localStorage.getItem("workspace:selected");
      setWorkspaceId(id);
    } catch {
      setWorkspaceId(null);
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setAssets([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("content_items")
        .select(
          "id, title, body, media_url, channel, kind, status, created_at, updated_at, meta, hashtags, workspace_id",
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(200);

      if (cancelled) return;
      if (error) {
        console.error("Library query failed", error);
        setAssets([]);
        setLoading(false);
        return;
      }

      const mapped = (data ?? [])
        .filter((row) => Boolean(row.media_url || row.title || row.body))
        .map((row) =>
          normalizeLibraryAsset({
            id: row.id,
            title: row.title ?? row.body ?? "Untitled asset",
            media_url: row.media_url,
            kind: row.kind,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            workspace_id: row.workspace_id,
            channel: row.channel,
            metadata: (row.meta as Record<string, unknown>) ?? {},
            source: row.kind?.includes("image") ? "generated" : "uploaded",
          }),
        );

      setAssets(mapped);
      if (!selectedId && mapped.length > 0) setSelectedId(mapped[0].id);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase();
    let next = [...assets];

    if (tab !== "all") {
      const expected = tabTypeMap[tab];
      next = next.filter((asset) => {
        if (expected === "all") return true;
        if (expected === "brand") return asset.type === "image";
        if (expected === "download") return asset.type === "file";
        return asset.type === expected;
      });
    }

    if (normalizedQuery) {
      next = next.filter((asset) => {
        const haystack = [
          asset.name,
          asset.url,
          asset.platform,
          asset.type,
          asset.status,
          asset.provider,
          asset.model,
          asset.metadata?.title,
          asset.metadata?.campaign,
          asset.metadata?.project,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      });
    }

    next.sort((a, b) => {
      const aDate = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const bDate = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      switch (sort) {
        case "oldest":
          return aDate - bDate;
        case "updated":
          return bDate - aDate;
        case "az":
          return a.name.localeCompare(b.name);
        case "za":
          return b.name.localeCompare(a.name);
        case "newest":
        default:
          return bDate - aDate;
      }
    });

    return next;
  }, [assets, search, sort, tab]);

  const selectedAsset = filteredAssets.find((item) => item.id === selectedId) ?? filteredAssets[0] ?? null;

  useEffect(() => {
    if (!selectedAsset && filteredAssets[0]) setSelectedId(filteredAssets[0].id);
  }, [filteredAssets, selectedAsset]);

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      status: "queued" as const,
    }));

    setPendingUploads((prev) => [...prev, ...next]);
    const timers = next.map((item, index) =>
      window.setTimeout(() => {
        setPendingUploads((prev) =>
          prev.map((entry) =>
            entry.id === item.id ? { ...entry, status: entry.name.includes(".mp4") ? "failed" : "ready" } : entry,
          ),
        );
      }, 600 + index * 500),
    );

    window.setTimeout(() => timers.forEach((timer) => window.clearTimeout(timer)), 2200);
    toast.success(`${next.length} ${next.length === 1 ? "file" : "files"} queued for library upload`);
  };

  const createAsset = (kind: "image" | "video" | "content") => {
    if (kind === "image") toast.message("Create image opens Studio");
    if (kind === "video") toast.message("Create video opens Studio");
    if (kind === "content") toast.message("Create content opens Studio");
    window.dispatchEvent(new CustomEvent("toggle:studio"));
  };

  const downloadAsset = (asset: LibraryAsset) => {
    if (!asset.url) {
      toast.error("This asset has no downloadable URL.");
      return;
    }
    const link = document.createElement("a");
    link.href = asset.url;
    link.download = asset.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success("Download started");
  };

  const toggleFavorite = (assetId: string) => {
    setAssets((prev) =>
      prev.map((asset) =>
        asset.id === assetId ? { ...asset, isFavorite: !asset.isFavorite } : asset,
      ),
    );
  };

  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const emptyStateCopy = {
    all: "Your creative library is empty",
    images: "No images yet",
    videos: "No videos yet",
    files: "No files yet",
    "brand-assets": "No brand assets yet",
    downloads: "No downloads yet",
  } as const;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="border-b border-border/70 bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Library</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Everything you&apos;ve created, uploaded, and saved in Mellox.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => uploadRef.current?.click()}>
                <Upload className="h-4 w-4" />
                Upload
              </Button>
              <input
                ref={uploadRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <Button variant="default" size="sm" onClick={() => createAsset("image")}>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search library"
                placeholder="Search assets, projects, campaigns, platform, tags…"
                className="h-10 w-full rounded-xl border border-border bg-secondary/30 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 self-end">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/30 p-1">
                <button
                  type="button"
                  aria-label="Grid view"
                  onClick={() => setView("grid")}
                  className={cn(
                    "rounded-md p-2 transition-colors",
                    view === "grid" ? "bg-background text-foreground" : "text-muted-foreground",
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setView("list")}
                  className={cn(
                    "rounded-md p-2 transition-colors",
                    view === "list" ? "bg-background text-foreground" : "text-muted-foreground",
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-sm text-muted-foreground">
                <SlidersHorizontal className="h-4 w-4" />
                <select
                  aria-label="Sort assets"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  className="bg-transparent text-sm text-foreground outline-none"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="updated">Recently Updated</option>
                  <option value="az">Name A–Z</option>
                  <option value="za">Name Z–A</option>
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-all",
                  tab === item.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/20 text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {pendingUploads.length > 0 && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">Uploading {pendingUploads.length} file{pendingUploads.length === 1 ? "" : "s"}</div>
              <button type="button" onClick={() => setPendingUploads([])} className="text-xs text-muted-foreground hover:text-foreground">
                Clear
              </button>
            </div>
            <div className="space-y-2">
              {pendingUploads.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-2.5 py-2 text-sm">
                  <span className="truncate">{item.name}</span>
                  <span className={cn("text-xs font-medium", item.status === "ready" ? "text-green-600" : item.status === "failed" ? "text-red-500" : "text-muted-foreground")}>
                    {item.status === "queued" ? "Queued" : item.status === "ready" ? "Ready" : "Failed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="h-52 animate-pulse rounded-2xl border border-border bg-secondary/25"
              />
            ))}
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="flex h-full min-h-[360px] items-center justify-center">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-border bg-secondary/30 text-muted-foreground">
                <Folder className="h-6 w-6" />
              </div>
              <h2 className="text-xl font-semibold">{emptyStateCopy[tab]}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Images, videos, uploads and brand assets you create in Mellox will appear here.
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => uploadRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
                <Button size="sm" onClick={() => createAsset("image")}>
                  <Plus className="h-4 w-4" />
                  Create Image
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className={cn(view === "grid" ? "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" : "space-y-3")}>
            {filteredAssets.map((asset) => (
              <article
                key={asset.id}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                  view === "list" && "flex items-center gap-3 p-3",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(asset.id)}
                  className={cn("overflow-hidden", view === "list" ? "w-20 shrink-0" : "block w-full")}
                >
                  {asset.type === "video" || asset.type === "image" ? (
                    <div className="relative overflow-hidden rounded-xl bg-secondary/30">
                      {asset.type === "video" ? (
                        <div className="relative aspect-video bg-black/80">
                          <img
                            src={asset.url ?? ""}
                            alt={asset.name}
                            className="h-full w-full object-cover opacity-80"
                          />
                          <div className="absolute inset-0 grid place-items-center">
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white shadow-sm">
                              <Play className="ml-0.5 h-4 w-4" />
                            </div>
                          </div>
                          {asset.duration && (
                            <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              {Math.round(asset.duration)}s
                            </span>
                          )}
                        </div>
                      ) : (
                        <img src={asset.url ?? ""} alt={asset.name} className="h-32 w-full object-cover sm:h-40" />
                      )}
                    </div>
                  ) : (
                    <div className="grid h-32 place-items-center bg-secondary/20 text-muted-foreground sm:h-40">
                      {asset.type === "file" ? (
                        <FileText className="h-8 w-8" />
                      ) : asset.type === "brand" ? (
                        <Folder className="h-8 w-8" />
                      ) : (
                        <Download className="h-8 w-8" />
                      )}
                    </div>
                  )}
                </button>

                <div className={cn(view === "list" ? "min-w-0 flex-1" : "p-3")}> 
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {asset.type === "image" ? (
                          <ImageIcon className="h-3.5 w-3.5" />
                        ) : asset.type === "video" ? (
                          <VideoIcon className="h-3.5 w-3.5" />
                        ) : asset.type === "file" ? (
                          <FileText className="h-3.5 w-3.5" />
                        ) : asset.type === "brand" ? (
                          <Folder className="h-3.5 w-3.5" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span>{asset.type === "brand" ? "Brand asset" : asset.type}</span>
                      </div>
                      <h3 className="mt-1 truncate text-sm font-medium text-foreground">{asset.name}</h3>
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(asset.id)}
                        aria-label={asset.isFavorite ? "Remove favorite" : "Add favorite"}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          asset.isFavorite ? "bg-yellow-100 text-yellow-700" : "text-muted-foreground hover:bg-secondary",
                        )}
                      >
                        <Star className="h-3.5 w-3.5" fill={asset.isFavorite ? "currentColor" : "none"} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                    <div>{formatDate(asset.updatedAt ?? asset.createdAt)}</div>
                    {asset.platform && <div>{asset.platform}</div>}
                  </div>

                  <div className="mt-3 flex items-center gap-1.5">
                    {asset.url && (
                      <button
                        type="button"
                        onClick={() => downloadAsset(asset)}
                        className="rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] text-foreground hover:bg-secondary"
                      >
                        Download
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(asset.id)}
                      className="rounded-md border border-border bg-secondary/30 px-2 py-1 text-[11px] text-foreground hover:bg-secondary"
                    >
                      Preview
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {selectedAsset && (
        <LibraryPreviewModal
          asset={selectedAsset}
          onClose={() => setSelectedId(null)}
          onNext={() => {
            const index = filteredAssets.findIndex((asset) => asset.id === selectedAsset.id);
            const next = filteredAssets[(index + 1) % filteredAssets.length];
            if (next) setSelectedId(next.id);
          }}
          onPrevious={() => {
            const index = filteredAssets.findIndex((asset) => asset.id === selectedAsset.id);
            const prev = filteredAssets[(index - 1 + filteredAssets.length) % filteredAssets.length];
            if (prev) setSelectedId(prev.id);
          }}
          onDownload={downloadAsset}
          onFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

function LibraryPreviewModal({
  asset,
  onClose,
  onNext,
  onPrevious,
  onDownload,
  onFavorite,
}: {
  asset: LibraryAsset;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onDownload: (asset: LibraryAsset) => void;
  onFavorite: (assetId: string) => void;
}) {
  const isImage = asset.type === "image";
  const isVideo = asset.type === "video";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="relative flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="text-sm font-medium text-foreground">{asset.name}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onPrevious} className="rounded-md border border-border bg-secondary/35 p-2 text-muted-foreground hover:text-foreground" aria-label="Previous asset">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={onNext} className="rounded-md border border-border bg-secondary/35 p-2 text-muted-foreground hover:text-foreground" aria-label="Next asset">
              <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="rounded-md border border-border bg-secondary/35 p-2 text-muted-foreground hover:text-foreground" aria-label="Close preview">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden md:grid-cols-[1.4fr_0.8fr]">
          <div className="flex items-center justify-center bg-black/80 p-4">
            {isImage && asset.url ? (
              <img src={asset.url} alt={asset.name} className="max-h-full max-w-full rounded-xl object-contain" />
            ) : isVideo && asset.url ? (
              <video src={asset.url} controls className="max-h-full max-w-full rounded-xl object-contain bg-black">
                <track default kind="captions" />
              </video>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/20 text-center text-muted-foreground">
                <FileText className="mb-3 h-10 w-10" />
                <div className="text-lg font-medium text-foreground">{asset.name}</div>
                <div className="mt-1 text-sm">Preview not available for this file type</div>
              </div>
            )}
          </div>

          <aside className="border-t border-border/60 bg-card/95 p-4 md:border-l md:border-t-0">
            <div className="space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Name</div>
                <div className="mt-1 text-lg font-semibold">{asset.name}</div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow label="Type" value={asset.type} />
                <InfoRow label="Source" value={asset.source} />
                <InfoRow label="Created" value={new Date(asset.createdAt ?? Date.now()).toLocaleDateString()} />
                <InfoRow label="Status" value={asset.status ?? "ready"} />
                <InfoRow label="Project" value={asset.projectId ?? "—"} />
                <InfoRow label="Campaign" value={asset.campaignId ?? "—"} />
                <InfoRow label="Platform" value={asset.platform ?? "—"} />
                <InfoRow label="Size" value={asset.fileSize ? `${(asset.fileSize / 1024 / 1024).toFixed(2)} MB` : "—"} />
              </div>

              <div className="flex flex-wrap gap-2">
                {asset.url && (
                  <Button variant="secondary" size="sm" onClick={() => onDownload(asset)}>
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onFavorite(asset.id)}>
                  <Star className={cn("h-4 w-4", asset.isFavorite && "fill-current")} />
                  {asset.isFavorite ? "Favorited" : "Favorite"}
                </Button>
                <Button variant="ghost" size="sm">
                  <ExternalLink className="h-4 w-4" />
                  Open
                </Button>
              </div>

              <div className="rounded-xl border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">
                {asset.url ? (
                  <div className="break-all">URL: {asset.url}</div>
                ) : (
                  <div>No asset URL available.</div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/15 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm text-foreground">{value}</div>
    </div>
  );
}
