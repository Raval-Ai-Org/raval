// "Reuse what worked": which measured post comes back, and as what. Pure: the
// new piece is written later, in Studio; nothing here writes a word of it.
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { PlatformId } from "@/lib/social-platforms";
import type { AutopilotType } from "./contracts";

/** Measured posts needed before one can be called the best. */
export const REPURPOSE_MIN_PIECES = 3;
/** A post seen by fewer people than this is not worth repeating. */
export const REPURPOSE_MIN_VIEWS = 100;

export type RepurposeSource = {
  id: string;
  title: string;
  platform: string | null;
  contentType: string | null;
  views: number;
};

export type RepurposePick = {
  source: RepurposeSource;
  type: AutopilotType;
  platform: PlatformId;
};

/** Cheap formats only: a video or an article is a person's call. */
const ORDER: AutopilotType[] = ["carousel", "image", "social"];

/**
 * The best measured post that has not been reused yet, and a different format
 * the program allows on a platform it posts to. Null when there is too little
 * to go on, or no other format to turn it into.
 */
export function pickRepurpose(args: {
  pieces: RepurposeSource[];
  contentTypes: readonly string[];
  platforms: readonly string[];
  /** Ids of posts that were already reused. */
  used: ReadonlySet<string>;
}): RepurposePick | null {
  const measured = args.pieces.filter((p) => p.views > 0 && p.title.trim().length > 0);
  if (measured.length < REPURPOSE_MIN_PIECES) return null;
  const allowed = ORDER.filter((t) => args.contentTypes.includes(t));
  const ranked = [...measured].sort((a, b) => b.views - a.views);
  for (const source of ranked) {
    if (source.views < REPURPOSE_MIN_VIEWS) break;
    if (args.used.has(source.id)) continue;
    for (const type of allowed) {
      if (type === source.contentType) continue;
      const fits = (p: string) => STUDIO_FORMATS[type].platforms.includes(p as PlatformId);
      const platform =
        source.platform && args.platforms.includes(source.platform) && fits(source.platform)
          ? source.platform
          : args.platforms.find(fits);
      if (platform) return { source, type, platform: platform as PlatformId };
    }
  }
  return null;
}

const NOUN: Record<AutopilotType, string> = {
  social: "post",
  image: "image post",
  carousel: "carousel",
  video: "video",
  article: "article",
};

export function repurposeBrief(pick: RepurposePick): { brief: string; reason: string } {
  const views = pick.source.views.toLocaleString("en-US");
  return {
    brief: [
      `Our post "${pick.source.title}" reached more people than our other recent posts (${views} views).`,
      `Make a new ${NOUN[pick.type]} on the same idea for the people who missed it: the same point, a fresh opening and new wording.`,
      "Do not copy the earlier post. Use only facts from the brand context. Do not invent figures.",
    ].join(" "),
    reason: `Your best recent post (${views} views), in a new format.`,
  };
}
