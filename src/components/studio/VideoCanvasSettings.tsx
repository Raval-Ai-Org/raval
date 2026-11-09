"use client";

// Holo: a video's shape and length sit on the canvas under the prompt, not in
// a menu, for every kind of video. The values are the same ones the quote and
// the server settle on (`settleVideoControls`), so what is shown is what is
// made. Own footage (brand, recap, website) has no length to pick.

import { X } from "@/components/icons";
import { recommendedRatio } from "@/lib/studio/aspect";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { updateSession, type StudioSession } from "@/lib/studio/session-store";
import { isAiVideo, settleVideoControls } from "@/lib/studio/video/settle";
import { DEFAULT_STUDIO_VIDEO_MODEL } from "@/lib/studio/video/kinds";
import { acceptsEndFrame } from "@/lib/studio/video/end-frame";
import { lengthChoices } from "@/lib/studio/video/lengths";
import type { PromptMediaState } from "./PromptMedia";
import { RatioPicker, Segmented } from "./studio-ui";

const MOTION_LENGTHS = [8, 12, 20];

/** Whether the canvas shows the shape and length for this session. */
export function showsVideoCanvas(session: StudioSession): boolean {
  return session.type === "video";
}

export function VideoCanvasSettings({
  session,
  media,
  disabled,
}: {
  session: StudioSession;
  media?: PromptMediaState;
  disabled?: boolean;
}) {
  if (!showsVideoCanvas(session)) return null;
  const c = session.controls;
  const format = STUDIO_FORMATS[session.type];
  const set = (patch: Partial<StudioControls>) =>
    updateSession(session.id, {
      // A new length is a new price: drop the old quote.
      controls: { ...c, ...patch, ...("durationSec" in patch ? { videoQuote: undefined } : {}) },
    });
  const motionGraphic = c.videoMode === "motion";
  const ownFootage = c.videoMode === "brand" || c.videoMode === "recap" || c.videoMode === "site";
  const aiVideo = isAiVideo(session.type, c);
  const settled = aiVideo
    ? settleVideoControls({
        type: session.type,
        controls: c,
        brief: session.brief,
        template: session.template,
        source: {
          picture: !!session.sourceContentId,
          script: !!session.sourceScript,
          product: !!c.productId,
        },
      })
    : c;
  const lengths = motionGraphic
    ? MOTION_LENGTHS
    : aiVideo
      ? lengthChoices(
          settled.videoModelKey ?? DEFAULT_STUDIO_VIDEO_MODEL,
          settled.videoKind ?? "product-motion",
        )
      : [];
  const length = motionGraphic ? (c.durationSec ?? 12) : (settled.durationSec ?? lengths[0]);
  const recommended = format.ratios.length
    ? recommendedRatio(c.platforms, "video", format.ratios)
    : undefined;
  const endFrame = c.endFrameAssetId;
  const endUrl = endFrame ? media?.library.find((p) => p.id === endFrame)?.url : undefined;
  const endUsed = !!endFrame && acceptsEndFrame(settled.videoKind);

  return (
    <fieldset
      disabled={disabled}
      className="ds-enter grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2"
      data-testid="video-canvas-settings"
    >
      <legend className="sr-only">Video shape and length</legend>
      {format.ratios.length ? (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-foreground">Aspect ratio</p>
          <RatioPicker
            ratios={format.ratios}
            value={c.ratio}
            recommended={recommended}
            onChange={(ratio) => set({ ratio })}
          />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-foreground">Video length</p>
        {lengths.length && !ownFootage ? (
          <Segmented
            label="Video length"
            className="max-w-full flex-wrap"
            value={length}
            onChange={(durationSec) => set({ durationSec })}
            options={lengths.map((v) => ({ value: v, label: `${v}s` }))}
          />
        ) : (
          <p className="flex min-h-9 items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] px-3.5 text-xs text-muted-foreground">
            Follows your own footage
          </p>
        )}
      </div>
      {endFrame ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-2 pr-3 shadow-[var(--ds-card-shadow)] sm:col-span-2">
          <span className="grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--ds-well-bg)]">
            {endUrl ? (
              <img src={endUrl} alt="" className="animate-frame-in h-full w-full object-cover" />
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Ends on your end frame</span>
            <span className="block truncate text-xs text-muted-foreground">
              {endUsed
                ? "The video settles on the picture you chose."
                : "Only “Bring it to life” and “Animate the product” use an end frame."}
            </span>
          </span>
          <button
            type="button"
            onClick={() => set({ endFrameAssetId: undefined })}
            aria-label="Remove the end frame"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
