"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Globe,
  Image as ImageIcon,
  Sparkles,
  Spinner,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { OptionCards, SwitchRow } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { MAX_CLIPS, VIDEO_MODES } from "@/lib/studio/clip-edit";
import {
  MOTIONMOX_CHIPS,
  MOTIONMOX_ELEMENTS,
  type MotionMoxElementId,
} from "@/lib/studio/motionmox/elements";
import { siteCaptures, type SiteCapture } from "@/lib/studio/site-reel";
import { getVisualTaste } from "@/lib/brand-visuals.functions";
import { emitAppEvent } from "@/lib/app-events";

type VideoMode = NonNullable<StudioControls["videoMode"]>;
const MODE_ICON: Record<Exclude<VideoMode, "motion">, LucideIcon> = {
  generate: Sparkles,
  brand: Video,
  recap: ImageIcon,
  site: Globe,
};

/**
 * What MotionMox animates into the video. Nothing picked means Mellox reads it
 * from the description ("add our logo and a price tag"); the words themselves
 * always come from the brief and the approved copy, never made up.
 */
function MotionElementChips({
  mode,
  controls: c,
  set,
  disabled,
}: {
  mode: "brand" | "recap";
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
  disabled?: boolean;
}) {
  const chips = MOTIONMOX_CHIPS.filter((id) => mode === "brand" || id !== "captions");
  const picked = c.motionElements ?? [];
  const toggle = (id: MotionMoxElementId) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    set({ motionElements: next.length ? next : undefined });
  };
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">Add to the video</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add to the video">
        {chips.map((id) => {
          const on = picked.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                on
                  ? "border-primary-border bg-primary text-primary-foreground"
                  : "border-border bg-surface-2 text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {MOTIONMOX_ELEMENTS[id].label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {picked.length
          ? "Animated in with your colours. Prices and button words come from your description."
          : "Or just say it in the description, like “add our logo and end with 'Shop now'”."}
      </p>
    </div>
  );
}

/**
 * How the video is made: new footage, the brand's own clips, a recap of its
 * photos or its website. Clips and photos are added in the description box
 * (`PromptMedia`); this card only says what each choice needs.
 */
export function SourceClips({
  workspaceId,
  controls: c,
  set,
  disabled,
}: {
  workspaceId: string;
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
  disabled?: boolean;
}) {
  // A motion graphic is new footage too (picked under "Kind of video").
  const mode = !c.videoMode || c.videoMode === "motion" ? "generate" : c.videoMode;
  const value = c.sourceVideoAssetIds ?? [];
  const photoCount = c.referenceAssetIds?.length ?? 0;
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

  return (
    <div data-no-rhythm className="space-y-3 rounded-xl border border-border bg-surface-3 p-3.5">
      <p className="text-sm font-medium text-foreground">Make the video from</p>
      <OptionCards
        label="Make the video from"
        value={mode}
        onChange={(videoMode) =>
          // The website reel uses one capture; other modes start without it.
          // A kind drawn by code (motion post, motion graphic) belongs to the
          // mode it was picked in, so a new mode starts from Auto.
          set({
            videoMode,
            ...(videoMode === "site" || mode === "site" ? { referenceAssetIds: [] } : {}),
            ...(videoMode !== c.videoMode &&
            (c.videoKind === "motion-post" || c.videoKind === "motion-graphics")
              ? { videoKind: undefined, recapMotion: undefined }
              : {}),
          })
        }
        options={VIDEO_MODES.map((option) => ({ ...option, icon: MODE_ICON[option.value] }))}
      />

      {mode === "brand" && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {value.length
              ? `${value.length} of ${MAX_CLIPS} clips added in the box above.`
              : `Add up to ${MAX_CLIPS} clips in the box above, one minute in all.`}{" "}
            Mellox picks the best part of each and adds your design.
          </p>
          <SwitchRow
            label="Captions"
            hint="What's said, on screen"
            checked={c.clipCaptions !== false}
            disabled={disabled}
            onCheckedChange={(on) => set({ clipCaptions: on })}
          />
          <MotionElementChips mode="brand" controls={c} set={set} disabled={disabled} />
        </div>
      )}

      {mode === "recap" && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">
            {photoCount
              ? `${photoCount} of 6 photos added in the box above, in play order.`
              : "Add 2 to 6 photos in the box above, in play order."}
          </p>
          <SwitchRow
            label="Bring photos to life"
            hint={
              c.recapMotion === "ai"
                ? "AI motion · people may change · Economy and Standard use credits"
                : "Off: slow camera moves, photos stay exact"
            }
            checked={c.recapMotion === "ai"}
            disabled={disabled}
            onCheckedChange={(on) => set({ recapMotion: on ? "ai" : "camera" })}
          />
          <MotionElementChips mode="recap" controls={c} set={set} disabled={disabled} />
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
