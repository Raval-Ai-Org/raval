import { describe, expect, it } from "vitest";
import type { ClipAnalysis } from "@/lib/studio/smart-cut";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_FRAMES,
  UPLOAD_MESSAGES,
  finishGroups,
  sceneFrameTimes,
  uploadLabel,
  uploadProblem,
  uploadType,
  videoLengthProblem,
} from "./uploads";

const clip = (duration: number, cuts: number[] = [], dark: ClipAnalysis["dark"] = []) => ({
  duration,
  hasAudio: false,
  cuts,
  silences: [],
  frozen: [],
  dark,
});

describe("uploadProblem", () => {
  it("accepts photos and videos within their sizes", () => {
    expect(uploadProblem({ name: "a.png", type: "image/png", size: MAX_IMAGE_BYTES })).toBeNull();
    expect(
      uploadProblem({ name: "a.mov", type: "video/quicktime", size: MAX_VIDEO_BYTES }),
    ).toBeNull();
  });

  it("refuses other types, empty files and files over the limit", () => {
    expect(uploadProblem({ name: "a.gif", type: "image/gif", size: 10 })).toBe(
      UPLOAD_MESSAGES.type,
    );
    expect(uploadProblem({ name: "a.png", type: "image/png", size: 0 })).toBe(
      UPLOAD_MESSAGES.empty,
    );
    expect(uploadProblem({ name: "a.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toBe(
      UPLOAD_MESSAGES.imageSize,
    );
    expect(uploadProblem({ name: "a.mp4", type: "video/mp4", size: MAX_VIDEO_BYTES + 1 })).toBe(
      UPLOAD_MESSAGES.videoSize,
    );
  });
});

describe("uploadType", () => {
  it("keeps the browser's type and falls back to the extension", () => {
    expect(uploadType({ name: "x.mp4", type: "video/webm" })).toBe("video/webm");
    expect(uploadType({ name: "Clip.MOV", type: "" })).toBe("video/quicktime");
    expect(uploadType({ name: "noext", type: "" })).toBe("");
  });
});

describe("videoLengthProblem", () => {
  it("allows up to three minutes and refuses unreadable lengths", () => {
    expect(videoLengthProblem(180)).toBeNull();
    expect(videoLengthProblem(181)).toBe(UPLOAD_MESSAGES.tooLong);
    expect(videoLengthProblem(0)).toBe(UPLOAD_MESSAGES.unreadable);
    expect(videoLengthProblem(Number.NaN)).toBe(UPLOAD_MESSAGES.unreadable);
  });
});

describe("uploadLabel", () => {
  it("drops the extension and line breaks", () => {
    expect(uploadLabel("Summer\nshoot.final.jpg")).toBe("Summer shoot.final");
    expect(uploadLabel(".png")).toBe("Inspo");
  });
});

describe("finishGroups", () => {
  it("keeps each call to ten files and three videos", () => {
    const items = [
      ...Array.from({ length: 5 }, () => ({ kind: "video" as const })),
      ...Array.from({ length: 12 }, () => ({ kind: "image" as const })),
    ];
    const groups = finishGroups(items);
    expect(groups.flat()).toHaveLength(items.length);
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(10);
      expect(group.filter((i) => i.kind === "video").length).toBeLessThanOrEqual(3);
    }
  });
});

describe("sceneFrameTimes", () => {
  it("takes three stills across a single take", () => {
    expect(sceneFrameTimes(clip(10))).toEqual([0.1, 5, 9.5]);
  });

  it("takes the middle of each scene and skips very short ones", () => {
    expect(sceneFrameTimes(clip(10, [4, 4.2, 8]))).toEqual([2, 6.1, 9]);
  });

  it("moves a still out of black footage when the scene has a visible moment", () => {
    expect(sceneFrameTimes(clip(8, [4], [{ start: 1.5, end: 2.5 }]))).toEqual([1, 6]);
  });

  it("spreads stills evenly when there are more scenes than the limit", () => {
    const cuts = Array.from({ length: 29 }, (_, i) => i + 1);
    const times = sceneFrameTimes(clip(30, cuts));
    expect(times).toHaveLength(MAX_VIDEO_FRAMES);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
