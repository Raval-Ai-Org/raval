// A video's own soundtrack: a voiceover read from the storyboard's exact words
// and an instrumental music bed, mixed under the picture by FFmpeg. Pure and
// browser-safe; src/server/studio/audio/soundtrack.server.ts makes and mixes it.
//
// Rules:
//   - The voice says only the reviewed words, in order, and only as many as
//     fit the video at a natural pace. A line that doesn't fit is left out
//     whole, never cut mid-sentence.
//   - Music is always instrumental: a bed with words in it fights the voice
//     and the captions.
//   - The mix ducks the music under the voice and brings everything to the
//     same loudness as every other Mellox video (-14 LUFS).

import { LOUDNESS_FILTER } from "@/lib/studio/smart-cut";

/* ─────────────────────────────── voice ─────────────────────────────── */

/** A natural read: about 2.5 words a second (the storyboard's own limit). */
export const VOICE_WORDS_PER_SECOND = 2.5;
/** The voice starts a moment after the picture, and stops before the end. */
export const VOICE_LEAD_SECONDS = 0.3;
const VOICE_TAIL_SECONDS = 0.6;

export type VoiceTone = "warm" | "calm" | "bright" | "bold";

/** ElevenLabs voices on KIE (docs.kie.ai, text-to-speech), a small set that suits ads. */
export const VOICES: readonly {
  id: string;
  name: string;
  gender: "female" | "male";
  tone: VoiceTone;
}[] = [
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "female", tone: "bright" },
  { id: "uYXf8XasLslADfZ2MB4u", name: "Hope", gender: "female", tone: "warm" },
  { id: "pPdl9cQBQq4p6mRkZy2Z", name: "Emma", gender: "female", tone: "calm" },
  { id: "TC0Zp7WVFzhA8zpTlRqV", name: "Aria", gender: "female", tone: "bold" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "male", tone: "calm" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male", tone: "bright" },
  { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "male", tone: "bold" },
  { id: "EkK5I93UQWFDigLMpZcX", name: "James", gender: "male", tone: "warm" },
];

const TONE_WORDS: Record<VoiceTone, RegExp> = {
  warm: /\b(warm|friendly|caring|cosy|cozy|gentle|kind|homely|soft)\b/i,
  calm: /\b(calm|trusted|expert|premium|luxur\w*|elegant|minimal|serious|professional)\b/i,
  bright: /\b(playful|fun|bright|cheerful|young|fresh|upbeat|lively|witty)\b/i,
  bold: /\b(bold|confident|energetic|powerful|edgy|daring|loud|sporty|fearless)\b/i,
};

/** A small, stable hash so the same brand always gets the same voice. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The brand's voice: the tone its own voice words ask for, else warm; a
 * person's choice of gender is kept. The same brand always hears the same voice.
 */
export function pickVoice(args: {
  /** The brand's voice description (Brand DNA tone, the look's voice notes). */
  brandVoice?: string;
  gender?: "female" | "male";
  /** Usually the workspace id. */
  seed: string;
}): (typeof VOICES)[number] {
  const text = args.brandVoice ?? "";
  const tone =
    (Object.keys(TONE_WORDS) as VoiceTone[]).find((t) => TONE_WORDS[t].test(text)) ?? "warm";
  const pool = VOICES.filter((v) => v.tone === tone && (!args.gender || v.gender === args.gender));
  const list = pool.length ? pool : VOICES.filter((v) => !args.gender || v.gender === args.gender);
  return list[hash(args.seed) % list.length];
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The words the voice reads: the storyboard's lines in order, as many whole
 * lines as fit the video at a natural pace. Null when there is nothing to say.
 */
export function voiceoverText(lines: readonly string[], seconds: number): string | null {
  const budget = Math.floor(
    Math.max(0, seconds - VOICE_LEAD_SECONDS - VOICE_TAIL_SECONDS) * VOICE_WORDS_PER_SECOND,
  );
  const kept: string[] = [];
  let used = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const n = wordCount(line);
    if (used + n > budget) break;
    kept.push(/[.!?…]$/.test(line) ? line : `${line}.`);
    used += n;
  }
  return kept.length ? kept.join(" ") : null;
}

/** Reading speed for the provider (0.7-1.2): a little quicker when the words are many. */
export function voiceSpeed(text: string, seconds: number): number {
  const room = Math.max(1, seconds - VOICE_LEAD_SECONDS - VOICE_TAIL_SECONDS);
  const pace = wordCount(text) / room / VOICE_WORDS_PER_SECOND;
  return Math.round(Math.min(1.15, Math.max(0.95, pace)) * 100) / 100;
}

/* ─────────────────────────────── music ─────────────────────────────── */

export type MusicMood = "uplifting" | "calm" | "energetic" | "warm" | "dramatic" | "playful";

const MOOD_STYLE: Record<MusicMood, string> = {
  uplifting: "uplifting modern pop instrumental, bright synths, light percussion",
  calm: "calm minimal ambient instrumental, soft piano and pads",
  energetic: "energetic electronic instrumental, punchy drums, driving bass",
  warm: "warm acoustic instrumental, guitar and soft percussion",
  dramatic: "cinematic instrumental, swelling strings and deep pulses",
  playful: "playful quirky instrumental, plucks, claps and bouncy bass",
};

const MOOD_BPM: Record<MusicMood, number> = {
  uplifting: 112,
  calm: 80,
  energetic: 126,
  warm: 96,
  dramatic: 90,
  playful: 118,
};

const MOOD_WORDS: [MusicMood, RegExp][] = [
  ["energetic", /\b(energ\w*|sport\w*|fast|hype|power\w*|drop|bold|launch)\b/i],
  ["dramatic", /\b(cinematic|dramatic|epic|reveal|mystery|suspense|luxur\w*)\b/i],
  ["playful", /\b(playful|fun|funny|quirky|cute|silly|kids?|joke)\b/i],
  ["calm", /\b(calm|relax\w*|spa|sleep|minimal|serene|soft|wellness|clean)\b/i],
  ["warm", /\b(warm|cosy|cozy|home\w*|family|acoustic|story|heart\w*|craft\w*)\b/i],
  ["uplifting", /\b(uplift\w*|happy|bright|fresh|morning|positive|joy\w*)\b/i],
];

/** The music feel a video asks for, from its sound notes, the brand's look and the brief. */
export function musicMood(text: string): MusicMood {
  return MOOD_WORDS.find(([, re]) => re.test(text))?.[0] ?? "uplifting";
}

export const MUSIC_NEGATIVE_TAGS = "vocals, singing, lyrics, spoken word, voice, choir, rap";

/** The style line sent to the music model: always instrumental, a clean bed under a voice. */
export function musicStyle(mood: MusicMood, opts: { bpm?: number; look?: string } = {}): string {
  const bpm = Math.round(Math.min(140, Math.max(70, opts.bpm ?? MOOD_BPM[mood])));
  const look = opts.look ? `, ${opts.look.replace(/\s+/g, " ").trim().slice(0, 200)}` : "";
  return `${MOOD_STYLE[mood]}, ${bpm} bpm${look}, instrumental only, social media ad bed, clean modern mix, steady energy, clear ending`.slice(
    0,
    900,
  );
}

/** The beat length in seconds, for cutting and animating on the beat. */
export function beatSeconds(mood: MusicMood, bpm?: number): number {
  return 60 / (bpm ?? MOOD_BPM[mood]);
}

/* ──────────────────────────────── mix ──────────────────────────────── */

/** The music sits this far under the picture's own sound and the voice. */
export const MUSIC_GAIN_DB = -16;
/** The clip's own sound when a music bed plays: kept as ambience, under the music. */
export const CLIP_AMBIENCE_GAIN_DB = -12;

export type MixPlan = {
  /** FFmpeg -filter_complex, ending in [aout]. */
  filter: string;
  /** Inputs after the video, in order. */
  inputs: ("voice" | "music")[];
};

/**
 * The audio graph for one finished video. Input 0 is the video; then the voice
 * and the music when present. Null when there is nothing to add.
 */
export function mixPlan(args: {
  seconds: number;
  voice: boolean;
  music: boolean;
  /** The video already has a sound track. */
  videoAudio: boolean;
  /** Keep the clip's own sound (ambience) under a music bed. */
  keepClipAudio: boolean;
}): MixPlan | null {
  if (!args.voice && !args.music) return null;
  const seconds = Math.max(1, Math.round(args.seconds * 100) / 100);
  const inputs: MixPlan["inputs"] = [];
  const parts: string[] = [];
  const beds: string[] = [];
  const voiceIndex = args.voice ? inputs.push("voice") : 0;
  const musicIndex = args.music ? inputs.push("music") : 0;
  const fadeOut = Math.max(0, seconds - 1.2).toFixed(2);

  if (args.videoAudio && (args.keepClipAudio || !args.music)) {
    const gain = args.music ? CLIP_AMBIENCE_GAIN_DB : 0;
    parts.push(`[0:a]atrim=0:${seconds},asetpts=PTS-STARTPTS,volume=${gain}dB[clip]`);
    beds.push("[clip]");
  }
  if (args.voice) {
    const delay = Math.round(VOICE_LEAD_SECONDS * 1000);
    parts.push(
      `[${voiceIndex}:a]aresample=48000,adelay=${delay}|${delay},atrim=0:${seconds},asetpts=PTS-STARTPTS${args.music ? ",asplit=2[voice][key]" : "[voice]"}`,
    );
  }
  if (args.music) {
    parts.push(
      `[${musicIndex}:a]aresample=48000,atrim=0:${seconds},asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=${fadeOut}:d=1.2,volume=${MUSIC_GAIN_DB}dB[bed]`,
    );
    if (args.voice) {
      parts.push(
        `[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[ducked]`,
      );
      beds.push("[ducked]");
    } else beds.push("[bed]");
  }
  if (args.voice) beds.push("[voice]");
  const mixed =
    beds.length === 1
      ? `${beds[0]}anull[mixed]`
      : `${beds.join("")}amix=inputs=${beds.length}:duration=first:normalize=0[mixed]`;
  parts.push(mixed);
  parts.push(`[mixed]apad,atrim=0:${seconds},${LOUDNESS_FILTER}[aout]`);
  return { filter: parts.join(";"), inputs };
}
