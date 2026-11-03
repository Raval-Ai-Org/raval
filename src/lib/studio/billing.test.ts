import { describe, expect, it } from "vitest";
import {
  studioCapturedAmount,
  studioJobRenders,
  studioPriceLabel,
  studioTextOnlyRevision,
} from "./billing";
import type { StudioJob } from "./jobs";
import { retainStudioMedia } from "./revisions";
import { studioJobIsStale } from "./recovery";

describe("Studio charges follow the work requested", () => {
  it("charges for copy, not image generation, when the uploaded photo is kept", () => {
    expect(
      studioPriceLabel({
        type: "image",
        controls: { platforms: [], referenceMode: "preserve", referenceAssetIds: ["photo"] },
      }),
    ).toBe("12 credits");
    expect(
      studioPriceLabel({
        type: "image",
        controls: { platforms: [], referenceMode: "inspire", referenceAssetIds: ["photo"] },
      }),
    ).toBe("30 credits");
  });
  it.each(["social", "image", "video", "ad"] as const)(
    "keeps %s caption edits on the text price and never starts media",
    (type) => {
      const request = {
        type,
        controls: { platforms: [], includeImage: true },
        parentJobId: "original",
        refine: { instruction: "Shorten the caption", target: "captions" },
      };
      expect(studioTextOnlyRevision(request)).toBe(true);
      expect(studioJobRenders(request)).toBe(false);
      expect(studioPriceLabel(request)).toBe("4 credits");
    },
  );
  it("prices an explicit video retake with video units, and a preview with credits", () => {
    expect(
      studioPriceLabel({
        type: "video",
        controls: { platforms: [], durationSec: 10 },
        parentJobId: "original",
        refine: { instruction: "Remake the visual", target: "media" },
      }),
    ).toBe("2 video credits");
    expect(
      studioPriceLabel({ type: "video", controls: { platforms: [], videoPreview: true } }),
    ).toBe("30 credits");
  });
  it("charges only for copy when the requested optional image fails", () => {
    const job = {
      status: "succeeded",
      type: "social",
      output: { partial: [{ target: "media", error: "Unavailable" }] },
    } as StudioJob;
    expect(studioCapturedAmount(job, 30)).toBe(12);
    expect(studioCapturedAmount({ ...job, parent_job_id: "original" }, 30)).toBe(4);
    expect(studioCapturedAmount({ ...job, status: "failed" }, 30)).toBe(0);
  });
  it("does not change visual content or the other platform during a scoped caption edit", () => {
    const media = [
      {
        slot: "main",
        kind: "image" as const,
        ratio: "1:1" as const,
        status: "ready" as const,
        assetId: "original",
      },
    ];
    const previous = {
      media,
      concept: "The actual product",
      variants: [
        {
          platform: "instagram" as const,
          body: "Old caption",
          hashtags: [],
          title: "Post",
          chars: 11,
        },
        {
          platform: "linkedin" as const,
          body: "Keep this caption",
          hashtags: [],
          title: "Post",
          chars: 17,
        },
      ],
    };
    const result = retainStudioMedia(
      previous,
      {
        concept: "An invented scene",
        variants: [
          { platform: "instagram", body: "Better caption", hashtags: [], title: "Post", chars: 14 },
          {
            platform: "linkedin",
            body: "Unrequested change",
            hashtags: [],
            title: "Post",
            chars: 18,
          },
        ],
      },
      "instagram",
    );
    expect(result.media).toBe(media);
    expect(result.concept).toBe("The actual product");
    expect(result.variants?.map((variant) => variant.body)).toEqual([
      "Better caption",
      "Keep this caption",
    ]);
  });
});

describe("interrupted Studio jobs", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const time = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  it("detects a stranded text request without declaring a current one failed", () => {
    expect(
      studioJobIsStale(
        { status: "running", created_at: time(20), stage_at: time(16), provider_tasks: [] },
        now,
      ),
    ).toBe(true);
    expect(
      studioJobIsStale(
        { status: "running", created_at: time(20), stage_at: time(1), provider_tasks: [] },
        now,
      ),
    ).toBe(false);
  });
  it("allows an active render, with an absolute deadline to release abandoned holds", () => {
    expect(
      studioJobIsStale(
        {
          status: "running",
          created_at: time(30),
          stage_at: time(25),
          provider_tasks: [{ state: "pending" }],
        },
        now,
      ),
    ).toBe(false);
    // A paid render still queued at the provider after hours is kept...
    expect(
      studioJobIsStale(
        {
          status: "running",
          created_at: time(121),
          stage_at: time(1),
          provider_tasks: [{ state: "pending" }],
        },
        now,
      ),
    ).toBe(false);
    // ...until the absolute deadline, when a render that never answered is
    // failed and its hold released.
    expect(
      studioJobIsStale(
        {
          status: "running",
          created_at: time(24 * 60 + 1),
          stage_at: time(1),
          provider_tasks: [{ state: "pending" }],
        },
        now,
      ),
    ).toBe(true);
    // A job with nothing at a provider still ends at two hours.
    expect(
      studioJobIsStale(
        { status: "running", created_at: time(121), stage_at: time(1), provider_tasks: [] },
        now,
      ),
    ).toBe(true);
    expect(
      studioJobIsStale({ status: "succeeded", created_at: time(121), stage_at: time(121) }, now),
    ).toBe(false);
  });
});
