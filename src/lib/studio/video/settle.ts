// Settles what a new AI video will be before it is priced: its kind, the
// model it is made on and its length in whole clips. Pure and browser-safe:
// the composer, the quote route and createBilledStudioJob all call it, so the
// price a person sees is the price of what really runs.

import type { StudioControls } from "../jobs";
import type { StudioType } from "../formats";
import { pickVideoKind, studioVideoModelFor, usableKind, type KindSource } from "./kinds";
import { snapLength } from "./lengths";

/** A new AI video (not the brand's own clips, photos or website). */
export function isAiVideo(
  type: StudioType,
  controls: Pick<StudioControls, "videoMode" | "storyMode">,
) {
  if (type === "story") return controls.storyMode === "video";
  return type === "video" && (!controls.videoMode || controls.videoMode === "generate");
}

export type SettleArgs = {
  type: StudioType;
  controls: StudioControls;
  brief?: string;
  template?: string;
  source?: KindSource;
};

/**
 * The controls with `videoKind`, `videoModelKey` and `durationSec` decided.
 * Anything else is returned as it was. A motion post is not an AI video and
 * keeps its kind for the own-footage path to pick up.
 */
export function settleVideoControls(args: SettleArgs): StudioControls {
  const { type, controls } = args;
  if (!isAiVideo(type, controls)) return controls;
  const source = args.source ?? {};
  const picked = controls.videoKind ?? pickVideoKind(args.brief ?? "", source, args.template);
  // A Story video is one vertical piece: it is never a code-made motion post.
  // A photo the person attached can be chosen to come alive like a post's
  // picture (it is never picked for them: product photos are attached too).
  const kind = usableKind(
    type === "story" && picked === "motion-post" ? "living-picture" : picked,
    {
      ...source,
      picture: Boolean(source.picture || controls.referenceAssetIds?.length),
    },
  );
  const videoModelKey = studioVideoModelFor(kind, controls.videoModelKey);
  return {
    ...controls,
    videoKind: kind,
    videoModelKey,
    durationSec: snapLength(controls.durationSec, videoModelKey, kind),
  };
}
