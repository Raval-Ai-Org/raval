import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/color";
import {
  bestWindow,
  isTalky,
  parseAnalysis,
  pickTransition,
  plainAnalysis,
  shareTime,
  transitionFor,
  usableRange,
  xfadeOffsets,
  type ClipAnalysis,
} from "./smart-cut";
import {
  believableSegments,
  buildCues,
  captionBox,
  captionColours,
  emphasisOf,
  lineChars,
  speechShare,
  wrapWords,
} from "./captions";
import { END_CARD_SECONDS, MAX_EDIT_SECONDS, planClips, videoCanvas } from "./clip-edit";

// A log as FFmpeg 6 writes it (stats interleaved on the same line).
const LOG = `frame=    0 fps=0.0 q=-0.0 size=       0kB time=00:00:00.12 bitrate=   0.0kbits/s speed=24.7x    [silencedetect @ 0000017d7c05ab40] silence_start: 0
[scdet @ 0000017d7c15a300] lavfi.scd.score: 43.024, lavfi.scd.time: 1
[freezedetect @ 0000017d7c19e4c0] lavfi.freezedetect.freeze_start: 0
[freezedetect @ 0000017d7c19e4c0] lavfi.freezedetect.freeze_duration: 1
[freezedetect @ 0000017d7c19e4c0] lavfi.freezedetect.freeze_end: 1
[blackdetect @ 0000017d7b813240] black_start:0 black_end:1 black_duration:1
[silencedetect @ 0000017d7c05ab40] silence_end: 1.5001 | silence_duration: 1.5001
[scdet @ 0000017d7c15a300] lavfi.scd.score: 32.845, lavfi.scd.time: 3
[freezedetect @ 0000017d7c19e4c0] lavfi.freezedetect.freeze_start: 3`;

const clip = (patch: Partial<ClipAnalysis>): ClipAnalysis => ({
  ...plainAnalysis(10),
  ...patch,
});

describe("measuring a clip", () => {
  it("reads scene changes, dead footage and pauses from FFmpeg's log", () => {
    const a = parseAnalysis(LOG, 5, true);
    expect(a.cuts).toEqual([1, 3]);
    expect(a.dark).toEqual([{ start: 0, end: 1 }]);
    // An unfinished freeze runs to the end of the clip.
    expect(a.frozen).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 5 },
    ]);
    expect(a.silences).toEqual([{ start: 0, end: 1.5001 }]);
    expect(parseAnalysis(LOG, 5, false).silences).toEqual([]);
  });

  it("skips a black or frozen start and a silent lead-in when someone talks", () => {
    const a = clip({
      hasAudio: true,
      dark: [{ start: 0, end: 1 }],
      silences: [
        { start: 0, end: 2 },
        { start: 8.5, end: 10 },
      ],
    });
    expect(isTalky(a)).toBe(true);
    const range = usableRange(a);
    expect(range.start).toBeCloseTo(1.85);
    expect(range.end).toBeCloseTo(8.75);
  });

  it("keeps a quiet b-roll clip's sound-less parts (nobody talks, nothing to trim)", () => {
    const a = clip({ hasAudio: true, silences: [{ start: 0, end: 10 }] });
    expect(isTalky(a)).toBe(false);
    expect(usableRange(a)).toEqual({ start: 0, end: 10 });
  });

  it("never trims a clip to nothing", () => {
    const a = clip({ frozen: [{ start: 0, end: 10 }] });
    expect(usableRange(a)).toEqual({ start: 0, end: 10 });
  });

  it("starts the best window on a scene change and away from dead footage", () => {
    const a = clip({ duration: 30, frozen: [{ start: 0, end: 12 }], cuts: [12.4, 15, 18] });
    const window = bestWindow(a, 6);
    expect(window.start).toBeGreaterThanOrEqual(12);
    expect(window.start).toBeLessThanOrEqual(12.5);
    expect(window.seconds).toBe(6);
  });

  it("ends a talking clip at a pause instead of mid-word", () => {
    const a = clip({
      duration: 20,
      hasAudio: true,
      silences: [
        { start: 4.6, end: 5.2 },
        { start: 12, end: 12.5 },
      ],
    });
    const window = bestWindow(a, 5);
    // Starts as the second sentence starts, stops at the next pause.
    expect(window.start).toBeCloseTo(5.2);
    expect(window.start + window.seconds).toBeLessThanOrEqual(10.21);
  });
});

describe("sharing the minute between clips", () => {
  it("gives short clips all of themselves and shares the rest", () => {
    expect(shareTime([3, 30, 30], 40, 20)).toEqual([3, 18.5, 18.5]);
    expect(shareTime([5, 5], 40, 20)).toEqual([5, 5]);
    expect(shareTime([0, 30], 10, 20)).toEqual([0, 10]);
  });

  it("keeps every clip in the video instead of dropping the last ones", () => {
    const plan = planClips([30, 30, 30, 30, 30]);
    expect(plan.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    const total = plan.reduce((sum, p) => sum + p.seconds, 0);
    expect(total).toBeLessThanOrEqual(MAX_EDIT_SECONDS - END_CARD_SECONDS + 0.05);
  });

  it("uses measured clips' best part", () => {
    const plan = planClips([clip({ duration: 12, dark: [{ start: 0, end: 2 }] })]);
    expect(plan[0].start).toBeGreaterThanOrEqual(1.8);
  });
});

describe("joins between pieces", () => {
  it("keeps one style per video and fades photo recaps", () => {
    expect(pickTransition("seed-a", "brand")).toBe(pickTransition("seed-a", "brand"));
    expect(pickTransition("anything", "recap")).toBe("fade");
  });

  it("never lets a join eat a short piece, and computes FFmpeg's offsets", () => {
    expect(transitionFor([4])).toBe(0);
    expect(transitionFor([4, 0.6])).toBe(0.2);
    expect(transitionFor([4, 0.2])).toBe(0);
    expect(xfadeOffsets([4, 4, 3], 0.35)).toEqual([3.65, 7.3]);
  });
});

describe("captions", () => {
  it("drops segments heard in silence, repeated loops and empty text", () => {
    const kept = believableSegments(
      [
        { start: 0, end: 2, text: "Welcome to the launch" },
        { start: 2, end: 4, text: "thanks for watching" },
        { start: 4, end: 5, text: "  " },
        { start: 5, end: 6, text: "again" },
        { start: 6, end: 7, text: "again" },
        { start: 7, end: 8, text: "again" },
      ],
      8,
      [{ start: 2, end: 4 }],
    );
    expect(kept.map((s) => s.text)).toEqual(["Welcome to the launch", "again", "again"]);
  });

  it("strips control and direction characters from what is shown", () => {
    const [s] = believableSegments([{ start: 0, end: 1, text: "Hi‮ there\u0007" }], 1);
    expect(s.text).toBe("Hi there");
  });

  it("wraps into at most two lines", () => {
    expect(wrapWords(["one", "two", "three"], 9)).toEqual([["one", "two"], ["three"]]);
    expect(wrapWords(["aaaaaaaa", "bbbbbbbb", "cccccccc"], 9)).toBeNull();
  });

  it("highlights a number first, else the longest meaningful word", () => {
    expect(
      emphasisOf([
        ["We", "sold"],
        ["300", "chairs"],
      ]),
    ).toEqual([1, 0]);
    expect(emphasisOf([["the", "handmade", "table"]])).toEqual([0, 1]);
    expect(emphasisOf([["so", "it", "is"]])).toBeNull();
  });

  it("chunks speech into short, readable, non-overlapping cues", () => {
    const cues = buildCues(
      [
        {
          start: 0,
          end: 6,
          text: "Our new collection is here, made by hand in Lahore, and it ships today.",
        },
      ],
      "9:16",
      6,
    );
    expect(cues.length).toBeGreaterThan(2);
    for (const [i, cue] of cues.entries()) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines)
        expect(line.join(" ").length).toBeLessThanOrEqual(lineChars("9:16"));
      expect(cue.end).toBeGreaterThan(cue.start);
      if (cues[i + 1]) expect(cue.end).toBeLessThanOrEqual(cues[i + 1].start);
    }
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(6);
    // Breaks after the clause.
    expect(cues[0].lines.flat().at(-1)).toMatch(/,$/);
  });

  it("never leaves a small word hanging at the end of a cue", () => {
    const cues = buildCues(
      [{ start: 2.7, end: 6, text: "Fresh bread comes out of the oven at 6:00 every morning." }],
      "9:16",
      6,
    );
    for (const cue of cues.slice(0, -1))
      expect(["at", "the", "of"]).not.toContain(cue.lines.flat().at(-1));
  });

  it("sits above the Reels buttons and inside the frame", () => {
    for (const ratio of ["9:16", "4:5", "1:1", "16:9", "3:4", "4:3"] as const) {
      const canvas = videoCanvas(ratio);
      const box = captionBox(ratio, canvas);
      const landscape = canvas.width > canvas.height;
      expect(box.y).toBeGreaterThan(canvas.height * 0.45);
      expect(box.y + box.height).toBeLessThanOrEqual(canvas.height * (landscape ? 0.92 : 0.86));
      expect(box.y % 2).toBe(0);
    }
  });

  it("keeps the brand's colour on the highlighted word when it reads", () => {
    const plate = "#121214";
    const lime = captionColours(["#c6f432"]);
    expect(lime.highlight).toBe("#c6f432");
    const navy = captionColours(["#0b1f4d"]);
    expect(contrastRatio(navy.highlight, plate)).toBeGreaterThanOrEqual(4.5);
    expect(captionColours([]).highlight).toBe("#ffd84d");
    expect(captionColours(["#ffffff"]).highlight).toBe("#ffd84d");
  });

  it("measures how much of a video is speech", () => {
    expect(speechShare(10, [{ start: 0, end: 9.5 }])).toBeCloseTo(0.05);
    expect(speechShare(10, [])).toBe(1);
  });
});
