import { describe, expect, it } from "vitest";
import {
  boardFramePrompt,
  boardFromCreatorScript,
  boardFromStoryboard,
  creatorBoardKey,
  creatorNeedsStoryboard,
  framePicks,
  isBoardSlot,
  keyFrameFor,
  MAX_BOARD_FRAMES,
  needsStoryboard,
  timecode,
} from "./board";
import type { VideoStoryboard } from "./storyboard";

const shot = (start: number, end: number, action: string) => ({
  start,
  end,
  camera: "slow push in",
  action,
  cast: [],
});

const sb: VideoStoryboard = {
  logline: "A morning candle ritual",
  bible: {
    cast: [{ id: "maya", look: "woman in her 30s, linen shirt" }],
    product: "amber glass candle",
    setting: "sunlit kitchen",
    lighting: "soft morning light",
    palette: "warm amber, cream",
    camera: "handheld, 35mm",
  },
  clips: [
    {
      opensOn: "candle on the counter",
      shots: [shot(0, 3, "Maya lights the candle"), shot(3, 8, "the flame catches")],
      endsOn: "flame",
      sound: "soft piano",
      onScreen: "Slow mornings",
      voiceover: "Start your day slower.",
    },
    {
      opensOn: "flame",
      shots: [shot(0, 4, "Maya pours coffee"), shot(4, 8, "candle beside the cup")],
      endsOn: "candle",
      sound: "",
      onScreen: "",
      voiceover: "Light it with your coffee.",
    },
  ],
};

describe("needsStoryboard", () => {
  const video = (controls: Record<string, unknown>) => ({ type: "video" as const, controls });
  it("storyboards long and premium AI videos only", () => {
    expect(needsStoryboard(video({ durationSec: 24 }) as never)).toBe(true);
    expect(needsStoryboard(video({ durationSec: 8, videoModelKey: "premium" }) as never)).toBe(
      true,
    );
    expect(needsStoryboard(video({ durationSec: 8, videoModelKey: "standard" }) as never)).toBe(
      false,
    );
    expect(needsStoryboard(video({ durationSec: 24, videoMode: "recap" }) as never)).toBe(false);
    expect(needsStoryboard(video({ durationSec: 24, videoKind: "motion-graphics" }) as never)).toBe(
      false,
    );
    expect(needsStoryboard({ type: "image", controls: { durationSec: 30 } } as never)).toBe(false);
    expect(
      needsStoryboard({
        type: "story",
        controls: { storyMode: "video", durationSec: 16 },
      } as never),
    ).toBe(true);
  });
});

describe("boardFromStoryboard", () => {
  const board = boardFromStoryboard(sb, [8, 8]);

  it("lays every shot out on one timeline", () => {
    expect(board.seconds).toBe(16);
    expect(board.scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 3],
      [3, 8],
      [8, 12],
      [12, 16],
    ]);
    expect(board.scenes[0].words).toBe("Start your day slower.");
    expect(board.scenes[2].words).toBe("Light it with your coffee.");
    expect(board.scenes[1].words).toBe("");
  });

  it("draws the first frame in main and the rest in board slots", () => {
    const slots = board.scenes.map((s) => s.frameSlot);
    expect(slots[0]).toBe("main");
    expect(slots.filter(Boolean).length).toBe(3);
    expect(slots.filter((s) => s && isBoardSlot(s)).length).toBe(2);
  });

  it("keeps the look in the bible and asks for no words in frames", () => {
    expect(board.bible.map((b) => b.label)).toContain("Setting");
    const prompt = boardFramePrompt(sb, board.scenes[2]);
    expect(prompt).toContain("Maya pours coffee");
    expect(prompt).toContain("sunlit kitchen");
    expect(prompt).toContain("No words");
  });
});

describe("framePicks", () => {
  it("draws three key frames: the opening, a clip opening near the middle, the end", () => {
    const scenes = Array.from({ length: 12 }, (_, i) => ({ clip: Math.floor(i / 3) }));
    const picks = framePicks(scenes);
    expect(picks.length).toBe(MAX_BOARD_FRAMES);
    expect(picks[0]).toBe(0);
    expect(picks[2]).toBe(11);
    expect([3, 6, 9]).toContain(picks[1]);
    expect(framePicks([])).toEqual([]);
    expect(framePicks([{ clip: 0 }, { clip: 0 }])).toEqual([0, 1]);
  });
  it("covers every scene with the key frame it follows from", () => {
    const board = {
      logline: "",
      seconds: 10,
      bible: [],
      scenes: [0, 1, 2, 3].map((i) => ({
        id: String(i),
        number: i + 1,
        clip: 0,
        start: i,
        end: i + 1,
        camera: "",
        action: "",
        words: "",
        onScreen: "",
        sound: "",
        frameSlot: i === 0 ? "main" : i === 2 ? "board:1" : undefined,
      })),
    };
    expect(keyFrameFor(board, 1)).toEqual({ slot: "main", own: false });
    expect(keyFrameFor(board, 2)).toEqual({ slot: "board:1", own: true });
    expect(keyFrameFor(board, 3)).toEqual({ slot: "board:1", own: false });
  });
  it("storyboards a Creator video only when it is long and has many scenes", () => {
    const four = { scenes: [1, 2, 3, 4] };
    expect(creatorNeedsStoryboard(four, 20)).toBe(true);
    expect(creatorNeedsStoryboard({ scenes: [1, 2] }, 20)).toBe(false);
    expect(creatorNeedsStoryboard(four, 10)).toBe(false);
    expect(creatorNeedsStoryboard(null, 30)).toBe(false);
  });
});

describe("creator storyboard", () => {
  const script = {
    hook: "I stopped buying candles",
    cta: "Link in bio",
    onScreen: "POV: you found it",
    scenes: [
      { id: "a", start: 0, end: 5, shot: "selfie", action: "talks", dialogue: "Hi", caption: "" },
      { id: "b", start: 5, end: 15, shot: "close", action: "shows", dialogue: "Look", caption: "" },
    ],
  };

  it("uses the script's own scenes and words", () => {
    const board = boardFromCreatorScript(script);
    expect(board.seconds).toBe(15);
    expect(board.scenes[0].onScreen).toBe("POV: you found it");
    expect(board.scenes.every((s) => s.frameSlot)).toBe(true);
  });

  it("changes its key when the script changes", () => {
    const a = creatorBoardKey(boardFromCreatorScript(script));
    const edited = {
      ...script,
      scenes: [{ ...script.scenes[0], dialogue: "Hello" }, script.scenes[1]],
    };
    expect(creatorBoardKey(boardFromCreatorScript(edited))).not.toBe(a);
  });

  it("formats time codes", () => {
    expect(timecode(0)).toBe("0:00");
    expect(timecode(75)).toBe("1:15");
  });
});
