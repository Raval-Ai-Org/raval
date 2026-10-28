import { describe, expect, it } from "vitest";
import type { StudioJob } from "./jobs";
import {
  isVariationsRequest,
  optionSlot,
  pictureChoices,
  variationCount,
  variationNote,
  variationsCaptured,
} from "./variations";
import {
  studioCapturedAmount,
  studioJobRenders,
  studioPriceLabel,
  studioTextOnlyRevision,
} from "./billing";
import { creationPointsFor } from "@/lib/billing/creation";
import { creditsFor } from "@/lib/billing/catalog";

const request = {
  type: "image" as const,
  controls: { platforms: [], variationCount: 3 },
  parentJobId: "00000000-0000-4000-8000-000000000001",
  refine: { instruction: "More versions", target: "variations" },
};

describe("variations requests", () => {
  it("are single-picture revisions that render", () => {
    expect(isVariationsRequest(request)).toBe(true);
    expect(isVariationsRequest({ ...request, type: "carousel" })).toBe(false);
    expect(isVariationsRequest({ ...request, parentJobId: undefined })).toBe(false);
    expect(studioTextOnlyRevision(request)).toBe(false);
    expect(studioJobRenders(request)).toBe(true);
  });

  it("are priced per picture from the catalog", () => {
    expect(studioPriceLabel(request)).toBe(`${creditsFor("image_standard") * 3} credits`);
    expect(studioPriceLabel({ ...request, controls: { platforms: [], variationCount: 2 } })).toBe(
      `${creditsFor("image_standard") * 2} credits`,
    );
    expect(creationPointsFor(request)).toBe(6);
  });

  it("clamp the count", () => {
    expect(variationCount({})).toBe(3);
    expect(variationCount({ variationCount: 9 })).toBe(4);
    expect(variationCount({ variationCount: 1 })).toBe(2);
  });

  it("describe a different composition for each version", () => {
    const notes = [0, 1, 2].map((i) => variationNote(i, 3));
    expect(new Set(notes).size).toBe(3);
    expect(notes[0]).toContain("version 1 of 3");
    expect(notes[0]).toContain("exact words");
  });
});

describe("charging", () => {
  const job = (ready: number, failed: number) =>
    ({
      type: "image",
      status: "succeeded",
      parent_job_id: request.parentJobId,
      input: {
        type: "image",
        controls: request.controls,
        intent: { brief: "x" },
        refine: request.refine,
      },
      output: {
        media: [
          { slot: "main", kind: "image", ratio: "1:1", status: "ready" },
          ...Array.from({ length: ready }, (_, i) => ({
            slot: optionSlot(i),
            kind: "image" as const,
            ratio: "1:1" as const,
            status: "ready" as const,
          })),
          ...Array.from({ length: failed }, (_, i) => ({
            slot: optionSlot(ready + i),
            kind: "image" as const,
            ratio: "1:1" as const,
            status: "failed" as const,
          })),
        ],
      },
    }) as unknown as StudioJob;

  it("charges only for versions that were made", () => {
    expect(variationsCaptured(job(3, 0), 45)).toBe(45);
    expect(variationsCaptured(job(2, 1), 45)).toBe(30);
    expect(studioCapturedAmount(job(1, 2), 45)).toBe(15);
    expect(studioCapturedAmount(job(0, 3), 45)).toBe(0);
  });

  it("lists the current picture first, then the versions", () => {
    expect(pictureChoices(job(2, 1).output.media).map((m) => m.slot)).toEqual([
      "main",
      "option:0",
      "option:1",
      "option:2",
    ]);
  });
});
