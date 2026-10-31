"use client";

import {
  ImagePlus,
  ListChecks,
  Megaphone,
  Palette,
  Repeat2,
  ShoppingBag,
  Sparkles,
  UserCircle2,
  Video,
  Wand,
  type LucideIcon,
} from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { StudioControls } from "@/lib/studio/jobs";
import { VIDEO_KINDS, type VideoKindId } from "@/lib/studio/video/kinds";
import { FieldLabel, OptionCards } from "./studio-ui";

const ICONS: Record<VideoKindId, LucideIcon> = {
  "living-picture": ImagePlus,
  "motion-post": Wand,
  "product-showcase": ShoppingBag,
  "brand-story": Video,
  "how-it-works": ListChecks,
  "before-after": Repeat2,
  "mood-broll": Palette,
  "offer-teaser": Megaphone,
};

type Choice = VideoKindId | "auto";

/**
 * What kind of AI video to make. "Auto" lets Mellox pick from the brief; the
 * pick is shown under the cards. A motion post moves the brand's own picture
 * with code (no AI), so it switches to the photo path. A person talking to
 * the camera is a Creator video, made in the UGC studio.
 */
export function VideoKindPicker({
  controls: c,
  picked,
  set,
}: {
  controls: StudioControls;
  /** The kind the video will really be (settled), for the "Auto" note. */
  picked?: VideoKindId;
  set: (patch: Partial<StudioControls>) => void;
}) {
  const value: Choice = c.videoMode === "recap" ? "motion-post" : (c.videoKind ?? "auto");
  const choose = (next: Choice) => {
    // A new kind starts at its own length.
    if (next === "motion-post")
      return set({
        videoKind: next,
        videoMode: "recap",
        recapMotion: "camera",
        durationSec: undefined,
      });
    set({
      videoKind: next === "auto" ? undefined : next,
      ...(c.videoMode === "recap" ? { videoMode: "generate", recapMotion: undefined } : {}),
      durationSec: undefined,
    });
  };
  const autoName = picked ? VIDEO_KINDS.find((k) => k.id === picked)?.label : undefined;
  return (
    <div>
      <FieldLabel>Kind of video</FieldLabel>
      <OptionCards<Choice>
        label="Kind of video"
        value={value}
        onChange={choose}
        options={[
          {
            value: "auto",
            label: "Auto",
            hint: "Picked for you from what you write",
            icon: Sparkles,
          },
          ...VIDEO_KINDS.map((kind) => ({
            value: kind.id as Choice,
            label: kind.label,
            hint: kind.hint,
            icon: ICONS[kind.id],
          })),
        ]}
      />
      <button
        type="button"
        onClick={() => emitAppEvent("open:ugc-studio")}
        className="mt-2 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-left hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
      >
        <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-foreground">
            A person talking to the camera
          </span>
          <span className="block text-xs text-muted-foreground">Make it as a Creator video</span>
        </span>
      </button>
      {value === "auto" && autoName ? (
        <p className="mt-2 text-xs text-muted-foreground">Mellox will make: {autoName}</p>
      ) : null}
    </div>
  );
}
