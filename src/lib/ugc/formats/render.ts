// What a Creator render stores about its format, decided once at render start.
// Pure. The engine reads it back: `cutAt` and `join` shape the clips, and
// `hookText.cues` are drawn on the finished video by code.

import { hookCues, hookTextPreset, type HookCue, type HookTextPresetId } from "../hook-text";
import { fitScenes } from "../prompt";
import type { Brief, Script } from "../schemas";
import type { FormatJoin, UgcFormat } from "./types";

/** Made-up handles for a "Replying to" sticker: never a real account. */
const REPLY_HANDLES = [
  "not.convinced.yet",
  "skeptical_since_birth",
  "prove_it_pls",
  "just.asking.tbh",
  "doubter_in_chief",
  "hmm.okay.sure",
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type CreatorFormatSettings = {
  ugcFormat?: string;
  join?: FormatJoin;
  /** Beat boundaries in seconds, where a long video may be split into clips. */
  cutAt?: number[];
  /** `accent`: the brand's accent colour, used only by the `stacked` preset's key word. */
  hookText?: { preset: HookTextPresetId; cues: HookCue[]; accent?: string };
};

const HEX = /^#[0-9a-f]{6}$/i;

export function creatorFormatSettings(args: {
  brief: Pick<Brief, "hookText">;
  script: Script;
  format: UgcFormat | null;
  durationSec: number;
  seed: string;
  accent?: string | null;
}): CreatorFormatSettings {
  const { brief, script, format, durationSec } = args;
  const out: CreatorFormatSettings = {};
  if (format) {
    out.ugcFormat = format.id;
    out.join = format.join;
    out.cutAt = fitScenes(script.scenes, durationSec)
      .slice(1)
      .map((s) => s.start)
      .filter((t) => t > 0 && t < durationSec);
  }
  if (brief.hookText?.enabled !== false && script.onScreen.trim()) {
    const preset = hookTextPreset(brief.hookText?.preset ?? format?.hookText.preset ?? "classic");
    const reply = preset.id === "reply";
    const text = reply ? script.replyTo.trim() || script.onScreen : script.onScreen;
    const handle = REPLY_HANDLES[hash(args.seed) % REPLY_HANDLES.length];
    const cues = hookCues(text, preset.id, durationSec, {
      replyTo: reply ? `Replying to @${handle}` : undefined,
    });
    if (cues.length)
      out.hookText = {
        preset: preset.id,
        cues,
        ...(args.accent && HEX.test(args.accent) ? { accent: args.accent } : {}),
      };
  }
  return out;
}
