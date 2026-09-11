"use client";

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { normalizeLibraryAsset, type LibraryAsset } from "@/lib/library";
import {
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  RefreshCw,
  Video as VideoIcon,
} from "@/components/ui/gemini-icons";
import { toast } from "sonner";

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
    } catch (error) {
      console.error("Library query failed", error);
      toast.error("Could not load your library", {
        description: error instanceof Error ? error.message : undefined,
      });
      setAssets([]);
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
      <header className="flex items-center justify-between border-b border-border/70 bg-background/80 px-4 py-5 backdrop-blur-sm sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        </div>
        <button
          type="button"
          onClick={() => void loadAssets()}
          disabled={loading}
          aria-label="Refresh library"
          className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded-xl bg-secondary/25" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex min-h-[360px] items-center justify-center">
            <div className="grid aspect-square w-full max-w-xs place-items-center rounded-xl border border-dashed border-border bg-secondary/20">
              <Folder className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
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
