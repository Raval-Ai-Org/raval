"use client";

import { useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Upload, X } from "@/components/icons";
import { Segmented } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { MAX_CLIPS, VIDEO_MODES } from "@/lib/studio/clip-edit";

type Clip = { id: string; filename: string };
const CLIP_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_CLIP_BYTES = 50 * 1024 * 1024;

/**
 * How the video is made: new footage, the brand's own clips, or a recap of its
 * photos. Uploading is free; nothing is made until Generate.
 */
export function SourceClips({
  workspaceId,
  controls: c,
  set,
  disabled,
  onBusyChange,
}: {
  workspaceId: string;
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mode = c.videoMode ?? "generate";
  const value = c.sourceVideoAssetIds ?? [];

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
    <section className="space-y-2 rounded-xl border border-border p-3">
      <span className="text-sm font-medium">Make the video from</span>
      <Segmented
        label="Make the video from"
        className="max-w-full flex-wrap"
        value={mode}
        onChange={(videoMode) => set({ videoMode })}
        options={VIDEO_MODES}
      />
      {mode === "brand" && (
        <>
          <p className="text-xs text-muted-foreground">
            Your clips stay exactly as filmed. Mellox picks the best part of each, skips dead air,
            joins them smoothly and adds an opening design, your logo and a closing card. Up to{" "}
            {MAX_CLIPS} clips, one minute in all.
          </p>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">Captions</span>
              <span className="text-muted-foreground">What&apos;s said, on screen</span>
            </span>
            <Switch
              aria-label="Captions"
              checked={c.clipCaptions !== false}
              disabled={disabled}
              onCheckedChange={(on) => set({ clipCaptions: on })}
            />
          </label>
          <ul className="space-y-1">
            {value.map((id, index) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-xs"
              >
                <span className="truncate">
                  {clips.find((clip) => clip.id === id)?.filename ?? `Clip ${index + 1}`}
                </span>
                <button
                  type="button"
                  aria-label="Remove clip"
                  disabled={disabled || busy}
                  onClick={() => set({ sourceVideoAssetIds: value.filter((v) => v !== id) })}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept={CLIP_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => void upload([...(event.target.files ?? [])])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || busy || value.length >= MAX_CLIPS}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-3" />
            {busy ? "Uploading…" : "Upload clips"}
          </Button>
        </>
      )}
      {mode === "recap" && (
        <>
          <p className="text-xs text-muted-foreground">
            Choose 2 to 6 photos below, in the order they should play.
          </p>
          <Segmented
            label="How the photos move"
            className="max-w-full flex-wrap"
            value={c.recapMotion ?? "camera"}
            onChange={(recapMotion) => set({ recapMotion })}
            options={[
              { value: "camera", label: "Slow camera moves", hint: "Photos stay exact" },
              { value: "ai", label: "Bring photos to life", hint: "AI motion · people may change" },
            ]}
          />
        </>
      )}
    </section>
  );
}
