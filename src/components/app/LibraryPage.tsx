"use client";

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { normalizeLibraryAsset, type LibraryAsset } from "@/lib/library";
import {
  Image as ImageIcon,
  LayoutGrid,
  RefreshCw,
  Sparkles,
  Video as VideoIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { emitAppEvent } from "@/lib/app-events";

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

export function LibraryPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setWorkspaceId(localStorage.getItem("workspace:selected"));
    } catch {
      setWorkspaceId(null);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    if (!workspaceId) {
      setAssets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await authedFetch(
        `/api/assets/library?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        assets?: LibraryApiAsset[];
        error?: string;
        diagnostic?: { databaseAssets: number; accessibleAssets: number; returnedAssets: number };
      };
      if (!response.ok) throw new Error(payload.error || "Could not load your library");
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
      if (payload.diagnostic && process.env.NODE_ENV !== "production") {
        console.debug("Library diagnostic", payload.diagnostic);
      }
    } catch (cause) {
      console.error("Library query failed", cause);
      setError(cause instanceof Error ? cause.message : "The request failed.");
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void loadAssets();
    const refresh = () => void loadAssets();
    addAppEventListener("assets:changed", refresh);
    addAppEventListener("workspace:changed", refresh);
    return () => {
      removeAppEventListener("assets:changed", refresh);
      removeAppEventListener("workspace:changed", refresh);
    };
  }, [loadAssets, workspaceId]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-surface text-primary ring-1 ring-primary-border"
          >
            <LayoutGrid className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">Library</h1>
            <p className="truncate text-xs text-muted-foreground">
              {loading
                ? "Loading your assets…"
                : assets.length > 0
                  ? `${assets.length} ${assets.length === 1 ? "asset" : "assets"}`
                  : "Images and video generated in the Studio"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void loadAssets()}
          disabled={loading}
          aria-label="Refresh library"
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </Button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded-xl bg-secondary/25" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            title="Couldn't load your library"
            description="Your assets are still there — this was a problem fetching them."
            detail={error}
            onRetry={() => void loadAssets()}
          />
        ) : assets.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title="Nothing in your library yet"
            description="Images and video you generate in the Studio are saved here, ready to attach to a post."
            action={
              <Button onClick={() => emitAppEvent("open:studio")}>
                <Sparkles className="size-4" />
                Open the Studio
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {assets.map((asset) => (
              <a
                key={asset.id}
                href={asset.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                aria-label="View post image full size"
                className="group block aspect-square overflow-hidden rounded-xl bg-secondary/20 ring-1 ring-border/70 transition hover:ring-primary/50"
              >
                {asset.type === "video" && asset.url ? (
                  <video
                    src={asset.url}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    aria-label="Play generated video"
                    className="h-full w-full object-contain"
                  />
                ) : asset.url ? (
                  <img
                    src={asset.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]"
                  />
                ) : asset.type === "video" ? (
                  <VideoIcon className="m-auto h-8 w-8 text-muted-foreground" />
                ) : (
                  <ImageIcon className="m-auto h-8 w-8 text-muted-foreground" />
                )}
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
