"use client";

import {
  ImagePlus,
  ListChecks,
  Megaphone,
  MousePointerClick,
  Palette,
  Repeat2,
  RotateCcw,
  Type,
  Shapes,
  ShoppingBag,
  Sparkles,
  UserCircle2,
  Video,
  Wand,
  type LucideIcon,
} from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { StudioControls } from "@/lib/studio/jobs";
import { VIDEO_KIND_GROUPS, VIDEO_KINDS, type VideoKindId } from "@/lib/studio/video/kinds";
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
  "product-motion": RotateCcw,
  "product-demo": MousePointerClick,
  "broll-hook": Type,
  "motion-graphics": Shapes,
};

type Choice = VideoKindId | "auto";

/**
 * What kind of AI video to make, grouped by what the video is for. "Auto"
 * lets Mellox pick from the brief; the pick is shown under the cards, and so
 * is the kind made instead when a chosen one needs a picture there isn't. A motion post moves the brand's own picture
 * with code (no AI), so it switches to the photo path. A person talking to
 * the camera is a Creator video, made in the UGC studio.
 */
export function VideoKindPicker({
  controls: c,
  picked,
  hasPicture,
  set,
}: {
  controls: StudioControls;
  /** The kind the video will really be (settled), for the "Auto" note. */
  picked?: VideoKindId;
  /** A post picture or an attached photo to start from. */
  hasPicture: boolean;
  set: (patch: Partial<StudioControls>) => void;
}) {
  const value: Choice =
    c.videoMode === "recap"
      ? "motion-post"
      : c.videoMode === "motion"
        ? "motion-graphics"
        : (c.videoKind ?? "auto");
  const choose = (next: Choice) => {
    // A new kind starts at its own length.
    if (next === "motion-post")
      return set({
        videoKind: next,
        videoMode: "recap",
        recapMotion: "camera",
        durationSec: undefined,
        videoPeople: undefined,
      });
    // Drawn by code from a design (no video model, no people).
    if (next === "motion-graphics")
      return set({
        videoKind: next,
        videoMode: "motion",
        recapMotion: undefined,
        videoModelKey: undefined,
        durationSec: undefined,
        videoPeople: undefined,
      });
    // Who is on screen is decided again for the new kind.
    set({
      videoKind: next === "auto" ? undefined : next,
      ...(c.videoMode === "recap" || c.videoMode === "motion"
        ? { videoMode: "generate", recapMotion: undefined }
        : {}),
      durationSec: undefined,
      videoPeople: undefined,
    });
  };
  const nameOf = (id: VideoKindId | undefined) => VIDEO_KINDS.find((k) => k.id === id)?.label;
  const optionsFor = (group: (typeof VIDEO_KIND_GROUPS)[number]["id"]) =>
    VIDEO_KINDS.filter((kind) => kind.group === group).map((kind) => ({
      value: kind.id as Choice,
      label: kind.label,
      hint: kind.needsSource && !hasPicture ? "Add a photo in the box above first" : kind.hint,
      icon: ICONS[kind.id],
    }));
  // Settling swapped the chosen kind (it needs a picture there isn't).
  const swapped =
    value !== "auto" && value !== "motion-graphics" && picked && picked !== value
      ? nameOf(picked)
      : undefined;
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
        ]}
        className="min-[420px]:grid-cols-1"
      />
      {VIDEO_KIND_GROUPS.map((group) => (
        <div key={group.id} className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          <OptionCards<Choice>
            label={`Kind of video: ${group.label}`}
            value={value}
            onChange={choose}
            options={optionsFor(group.id)}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => emitAppEvent("open:ugc-studio")}
        className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-left hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
      >
        <UserCircle2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-foreground">
            A person talking to the camera
          </span>
          <span className="block text-xs text-muted-foreground">Make it as a Creator video</span>
        </span>
      </button>
      {value === "auto" && picked ? (
        <p className="mt-2 text-xs text-muted-foreground">Mellox will make: {nameOf(picked)}</p>
      ) : swapped ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This needs a picture to start from, so Mellox will make: {swapped}
        </p>
      ) : null}
    </div>
  );
}
