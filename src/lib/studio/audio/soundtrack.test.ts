import { describe, expect, it } from "vitest";
import {
  MUSIC_GAIN_DB,
  VOICES,
  mixPlan,
  musicMood,
  musicStyle,
  pickVoice,
  voiceSpeed,
  voiceoverText,
} from "./soundtrack";

describe("voiceover", () => {
  it("reads whole lines in order, only as many as fit at a natural pace", () => {
    // 8 s: (8 - 0.3 - 0.6) * 2.5 = 17 words.
    const lines = ["Meet the bottle that keeps coffee hot", "all day long", "Order yours today"];
    expect(voiceoverText(lines, 8)).toBe(
      "Meet the bottle that keeps coffee hot. all day long. Order yours today.",
    );
    // 4 s: 7 words, so the first line (7 words) fits and the second is left out whole.
    expect(voiceoverText(lines, 4)).toBe("Meet the bottle that keeps coffee hot.");
    expect(voiceoverText(["", "  "], 8)).toBeNull();
    expect(voiceoverText(["far too many words for one short second of video"], 1)).toBeNull();
  });

  it("keeps the same brand on the same voice and follows its tone and the chosen gender", () => {
    const a = pickVoice({ brandVoice: "Calm, expert and premium", seed: "ws-1" });
    expect(pickVoice({ brandVoice: "Calm, expert and premium", seed: "ws-1" })).toBe(a);
    expect(a.tone).toBe("calm");
    const male = pickVoice({ brandVoice: "playful and fun", gender: "male", seed: "ws-2" });
    expect(male).toMatchObject({ gender: "male", tone: "bright" });
    expect(VOICES.map((v) => v.id)).toContain(pickVoice({ seed: "x" }).id);
  });

  it("speeds up a little for a full read, never faster than 1.15", () => {
    expect(voiceSpeed("one two", 8)).toBe(0.95);
    expect(voiceSpeed(Array(40).fill("word").join(" "), 8)).toBe(1.15);
  });
});

describe("music bed", () => {
  it("picks a mood from the words and always asks for an instrumental", () => {
    expect(musicMood("Fast, energetic sports launch")).toBe("energetic");
    expect(musicMood("A calm spa morning")).toBe("calm");
    expect(musicMood("nothing in particular")).toBe("uplifting");
    const style = musicStyle("calm", { bpm: 300 });
    expect(style).toContain("140 bpm");
    expect(style).toContain("instrumental only");
  });
});

describe("mix", () => {
  it("adds nothing when there is no voice or music", () => {
    expect(
      mixPlan({ seconds: 16, voice: false, music: false, videoAudio: true, keepClipAudio: true }),
    ).toBeNull();
  });

  it("ducks the music under the voice, keeps the clip as ambience and ends at -14 LUFS", () => {
    const plan = mixPlan({
      seconds: 16,
      voice: true,
      music: true,
      videoAudio: true,
      keepClipAudio: true,
    })!;
    expect(plan.inputs).toEqual(["voice", "music"]);
    expect(plan.filter).toContain("[1:a]aresample=48000,adelay=300|300");
    expect(plan.filter).toContain(`volume=${MUSIC_GAIN_DB}dB[bed]`);
    expect(plan.filter).toContain("[bed][key]sidechaincompress");
    expect(plan.filter).toContain("[clip][ducked][voice]amix=inputs=3");
    expect(plan.filter).toContain("loudnorm=I=-14");
    expect(plan.filter.endsWith("[aout]")).toBe(true);
  });

  it("uses the music alone when the video is silent, and the voice alone with its own sound", () => {
    const music = mixPlan({
      seconds: 8,
      voice: false,
      music: true,
      videoAudio: false,
      keepClipAudio: true,
    })!;
    expect(music.inputs).toEqual(["music"]);
    expect(music.filter).toContain("[1:a]aresample");
    expect(music.filter).toContain("[bed]anull[mixed]");
    const voice = mixPlan({
      seconds: 8,
      voice: true,
      music: false,
      videoAudio: true,
      keepClipAudio: false,
    })!;
    // With no music the clip's own sound stays at full level under the voice.
    expect(voice.filter).toContain("volume=0dB[clip]");
    expect(voice.filter).toContain("[clip][voice]amix=inputs=2");
  });
});
