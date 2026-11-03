import type { PlatformId } from "@/lib/social-platforms";
import { BriefSchema, ScriptSchema, type Script } from "@/lib/ugc/schemas";
import { SourceScriptSchema, type ScriptOutput } from "./jobs";

export type ScriptVideoSource = {
  workspaceId: string;
  script: ScriptOutput;
  platforms: PlatformId[];
};

/** The beat voiceovers are the spoken script; hook/CTA metadata must not duplicate them. */
export function scriptScenes(source: ScriptOutput): Script["scenes"] {
  const script = SourceScriptSchema.parse(source);
  return script.beats.map((beat, index) => {
    const times = [...beat.time.matchAll(/(\d+):(\d{2})|(\d+(?:\.\d+)?)/g)].map((m) =>
      m[1] ? Number(m[1]) * 60 + Number(m[2]) : Number(m[3]),
    );
    const valid = times?.length === 2 && times[0] < times[1] && times[1] <= script.durationSec;
    return {
      id: `scene-${index + 1}`,
      start: valid ? times[0] : (index * script.durationSec) / script.beats.length,
      end: valid ? times[1] : ((index + 1) * script.durationSec) / script.beats.length,
      shot: "",
      action: beat.visual,
      dialogue: beat.voiceover,
      caption: beat.onScreen ?? "",
      productPlacement: "",
    };
  });
}

export function toCreatorScript(source: ScriptOutput): Script {
  return ScriptSchema.parse({
    hook: source.hook || source.beats[0]?.voiceover,
    scenes: scriptScenes(source),
    cta: source.cta,
    postCaption: source.caption,
    hashtags: [],
    factIds: [],
  });
}

export function creatorBrief(source: ScriptVideoSource) {
  const platform = source.platforms[0];
  return BriefSchema.parse({
    scriptSource: "studio",
    durationSec: source.script.durationSec,
    platform:
      platform === "instagram"
        ? "reels"
        : platform === "youtube"
          ? "shorts"
          : platform === "facebook"
            ? "facebook"
            : "tiktok",
    instructions:
      "Use the supplied script verbatim, in its original language. Preserve the scene order and call to action. Do not translate or invent dialogue.",
  });
}

/**
 * The reviewed script's scenes that fall inside one clip of a storyboarded
 * video, with the words kept exactly. A scene belongs to the clip its middle
 * falls in, so every scene is sent once.
 */
export function sourceScriptClipDirection(
  source: ScriptOutput,
  clip: { start: number; seconds: number },
  totalSec: number,
  audio = true,
): string | null {
  const scale = totalSec / source.durationSec;
  const end = clip.start + clip.seconds;
  const scenes = scriptScenes(source).filter((scene) => {
    const middle = ((scene.start + scene.end) / 2) * scale;
    return middle >= clip.start && (middle < end || end >= totalSec);
  });
  if (!scenes.length) return null;
  return [
    "REVIEWED SCRIPT FOR THIS CLIP — keep these scenes in order and do not change the supplied words.",
    ...scenes.map(
      (scene) =>
        `${scene.action}${audio && scene.dialogue ? ` The creator says: ${JSON.stringify(scene.dialogue)}` : ""}`,
    ),
    audio
      ? "Speak the quoted words exactly once, in their original language."
      : "No speech. Follow the visual directions from the reviewed script.",
  ].join("\n");
}

/** Sent directly to the renderer so a short AI shot-plan cannot drop dialogue. */
export function sourceScriptDirection(
  source: ScriptOutput,
  audio = true,
  durationSec = source.durationSec,
): string {
  const scale = durationSec / source.durationSec;
  return [
    "REVIEWED SCRIPT — preserve these scenes and their order. Do not replace or paraphrase the supplied words. This script takes priority over any other shot plan.",
    `Opening intent: ${source.hook}\nClosing call to action: ${source.cta}. Use the quoted dialogue below; do not repeat it as extra speech.`,
    ...scriptScenes(source).map(
      (scene) =>
        `[${Math.round(scene.start * scale * 10) / 10}–${Math.round(scene.end * scale * 10) / 10}s] ${scene.action}${audio && scene.dialogue ? ` The creator says: ${JSON.stringify(scene.dialogue)}` : ""}`,
    ),
    audio
      ? "Speak the quoted words exactly once, in their original language."
      : "No speech. Follow the visual directions from the reviewed script.",
  ].join("\n");
}
