"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  Globe,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Spinner,
  Video,
  X,
  type LucideIcon,
} from "@/components/icons";
import { OptionCards, SwitchRow } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { MAX_CLIPS, VIDEO_MODES } from "@/lib/studio/clip-edit";
import { siteCaptures, type SiteCapture } from "@/lib/studio/site-reel";
import { getVisualTaste } from "@/lib/brand-visuals.functions";
import { emitAppEvent } from "@/lib/app-events";

type Clip = { id: string; filename: string };
type VideoMode = NonNullable<StudioControls["videoMode"]>;
const CLIP_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_CLIP_BYTES = 50 * 1024 * 1024;
const MODE_ICON: Record<VideoMode, LucideIcon> = {
  generate: Sparkles,
  brand: Video,
  recap: ImageIcon,
  site: Globe,
};

/**
 * How the video is made: new footage, the brand's own clips, a recap of its
 * photos or its website. Uploading is free; nothing is made until Generate.
 * `photos` is the photo picker, shown here for a recap so it sits with the
 * choice that needs it.
 */
export function SourceClips({
  workspaceId,
  controls: c,
  set,
  disabled,
  onBusyChange,
  photos,
}: {
  workspaceId: string;
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  photos?: React.ReactNode;
}) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mode = c.videoMode ?? "generate";
  const value = c.sourceVideoAssetIds ?? [];
  // Website captures are read (free) only once a person picks "My website".
  const [captures, setCaptures] = useState<SiteCapture[] | null>(null);
  useEffect(() => {
    if (mode !== "site" || captures) return;
    let cancelled = false;
    getVisualTaste({ data: { workspaceId } })
      .then((view) => {
        if (!cancelled) setCaptures(siteCaptures(view?.sources ?? []));
      })
      .catch(() => {
        if (!cancelled) setCaptures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, captures, workspaceId]);
  const picked = c.referenceAssetIds?.[0];

  const upload = async (files: File[]) => {
    if (!files.length || busy || disabled) return;
    const room = MAX_CLIPS - value.length;
    if (room <= 0) return void toast.error(`Up to ${MAX_CLIPS} clips. Remove one first.`);
    if (files.length > room)
      toast.info(`Only the first ${room} clip${room === 1 ? "" : "s"} will be used.`);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const added: Clip[] = [];
      for (const file of files.slice(0, room)) {
        if (!CLIP_TYPES.includes(file.type) || file.size > MAX_CLIP_BYTES) {
          toast.error(`${file.name}: choose an MP4, MOV or WebM clip under 50 MB.`);
          continue;
        }
        const params = new URLSearchParams({
          workspaceId,
          requestId: crypto.randomUUID(),
          filename: file.name,
        });
        const response = await authedFetch(`/api/assets/upload?${params}`, {
          method: "POST",
          workspaceId,
          headers: { "Content-Type": file.type },
          body: file,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.asset?.id) throw new Error("Could not upload the clip.");
        added.push({ id: body.asset.id, filename: file.name });
      }
      if (!added.length) return;
      setClips((current) => [...current, ...added]);
      set({ sourceVideoAssetIds: [...value, ...added.map((clip) => clip.id)] });
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not upload the clip.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div data-no-rhythm className="space-y-3 rounded-xl border border-border bg-surface-3 p-3.5">
      <p className="text-sm font-medium text-foreground">Make the video from</p>
      <OptionCards
        label="Make the video from"
        value={mode}
        onChange={(videoMode) =>
          // The website reel uses one capture; other modes start without it.
          set(
            videoMode === "site" || mode === "site"
              ? { videoMode, referenceAssetIds: [] }
              : { videoMode },
          )
        }
        options={VIDEO_MODES.map((option) => ({ ...option, icon: MODE_ICON[option.value] }))}
      />

      {mode === "brand" && (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <p className="text-xs font-medium text-foreground">Your clips</p>
            <p className="text-[11px] text-muted-foreground">
              Up to {MAX_CLIPS} clips, one minute in all. Mellox picks the best part of each and
              adds your design.
            </p>
          </div>
          <ul className="space-y-1.5">
            {value.map((id, index) => (
              <li
                key={id}
                className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-xs"
              >
                <Video className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {clips.find((clip) => clip.id === id)?.filename ?? `Clip ${index + 1}`}
                </span>
                <button
                  type="button"
                  aria-label="Remove clip"
                  disabled={disabled || busy}
                  onClick={() => set({ sourceVideoAssetIds: value.filter((v) => v !== id) })}
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
            {value.length < MAX_CLIPS && (
              <li>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50"
                >
                  {busy ? (
                    <Spinner className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  {busy ? "Uploading…" : value.length ? "Add another clip" : "Upload clips"}
                </button>
              </li>
            )}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept={CLIP_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => void upload([...(event.target.files ?? [])])}
          />
          <SwitchRow
            label="Captions"
            hint="What's said, on screen"
            checked={c.clipCaptions !== false}
            disabled={disabled}
            onCheckedChange={(on) => set({ clipCaptions: on })}
          />
        </div>
      )}

      {mode === "recap" && (
        <div className="space-y-3 border-t border-border pt-3">
          {photos}
          <SwitchRow
            label="Bring photos to life"
            hint={
              c.recapMotion === "ai"
                ? "AI motion · people may change · uses video credits"
                : "Off: slow camera moves, photos stay exact"
            }
            checked={c.recapMotion === "ai"}
            disabled={disabled}
            onCheckedChange={(on) => set({ recapMotion: on ? "ai" : "camera" })}
          />
        </div>
      )}

      {mode === "site" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            Pick a page. It scrolls on a phone or laptop in your colours, about 10 seconds.
          </p>
          {captures === null ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5 animate-spin" />
              Looking for your website pictures…
            </p>
          ) : captures.length ? (
            <ul className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
              {captures.slice(0, 9).map((capture) => (
                <li key={capture.assetId}>
                  <button
                    type="button"
                    aria-pressed={picked === capture.assetId}
                    disabled={disabled}
                    onClick={() => set({ referenceAssetIds: [capture.assetId] })}
                    className={cn(
                      "w-full overflow-hidden rounded-lg border text-left text-[11px] transition-colors",
                      picked === capture.assetId
                        ? "border-primary-border ring-2 ring-primary/40"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    {capture.thumb ? (
                      <img
                        src={capture.thumb}
                        alt=""
                        className="h-20 w-full bg-surface-2 object-cover object-top"
                      />
                    ) : (
                      <span className="block h-20 bg-surface-2" />
                    )}
                    <span className="block truncate px-2 py-1">
                      {capture.mobile ? "Phone · " : ""}
                      {capture.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No pictures of your website yet.{" "}
              <button
                type="button"
                className="font-medium text-foreground underline"
                onClick={() => emitAppEvent("open:inspo", { section: "media" })}
              >
                Add them in Inspo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
