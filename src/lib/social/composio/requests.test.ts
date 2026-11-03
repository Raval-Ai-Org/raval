import { describe, expect, it } from "vitest";
import { allowedTool, integrationApp } from "@/lib/integrations/catalog";
import {
  planPublish,
  postUrl,
  resolveArgs,
  resultId,
  type ComposioPost,
  type ComposioSocialPlatform,
} from "./requests";

const IMG = "https://cdn.example.com/a.jpg";
const IMG2 = "https://cdn.example.com/b.jpg";
const VID = "https://cdn.example.com/v.mp4";

function post(over: Partial<ComposioPost> = {}): ComposioPost {
  return {
    caption: "New beans #coffee",
    images: [],
    video: null,
    link: null,
    title: null,
    placement: "feed",
    ...over,
  };
}

function steps(plan: ReturnType<typeof planPublish>) {
  if (!plan.ok) throw new Error(plan.reason);
  return plan.steps;
}

describe("planPublish", () => {
  it("posts one Instagram picture in two steps, publishing the container it made", () => {
    const s = steps(
      planPublish(post({ images: [IMG] }), { platform: "instagram", destination: "17841" }),
    );
    expect(s.map((x) => x.tool)).toEqual([
      "INSTAGRAM_POST_IG_USER_MEDIA",
      "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    ]);
    expect(s[0].args).toMatchObject({
      ig_user_id: "17841",
      image_url: IMG,
      caption: "New beans %23coffee",
    });
    expect(s[1].args.creation_id).toEqual({ $fromStep: 0 });
  });

  it("makes an Instagram carousel from the slides, caption as written", () => {
    const s = steps(
      planPublish(post({ images: [IMG, IMG2] }), { platform: "instagram", destination: "17841" }),
    );
    expect(s[0]).toEqual({
      tool: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
      args: { ig_user_id: "17841", caption: "New beans #coffee", child_image_urls: [IMG, IMG2] },
    });
  });

  it("sends an Instagram video as a Reel and waits longer for it", () => {
    const s = steps(planPublish(post({ video: VID }), { platform: "instagram", destination: "1" }));
    expect(s[0].args).toMatchObject({ media_type: "REELS", video_url: VID, share_to_feed: true });
    expect(s[1].args.max_wait_seconds).toBe(300);
  });

  it("refuses what Instagram can't take", () => {
    const ig = { platform: "instagram" as const, destination: "1" };
    expect(planPublish(post(), ig).ok).toBe(false);
    expect(planPublish(post({ images: Array(11).fill(IMG) }), ig).ok).toBe(false);
    expect(planPublish(post({ images: [IMG], video: VID }), ig).ok).toBe(false);
  });

  it("picks the Facebook tool by how many pictures there are", () => {
    const fb = { platform: "facebook" as const, destination: "page1" };
    expect(steps(planPublish(post(), fb))[0].tool).toBe("FACEBOOK_CREATE_POST");
    expect(steps(planPublish(post({ images: [IMG] }), fb))[0]).toEqual({
      tool: "FACEBOOK_CREATE_PHOTO_POST",
      args: { page_id: "page1", url: IMG, message: "New beans #coffee", published: true },
    });
    expect(steps(planPublish(post({ images: [IMG, IMG2] }), fb))[0].tool).toBe(
      "FACEBOOK_CREATE_MULTI_PHOTO_POST",
    );
    expect(steps(planPublish(post({ video: VID }), fb))[0]).toMatchObject({
      tool: "FACEBOOK_CREATE_VIDEO_POST",
      args: { page_id: "page1", file_url: VID, description: "New beans #coffee", published: true },
    });
    expect(planPublish(post({ video: VID, images: [IMG] }), fb).ok).toBe(false);
  });

  it("posts LinkedIn text with the link added once", () => {
    const li = { platform: "linkedin" as const, destination: "urn:li:person:abc" };
    const s = steps(planPublish(post({ link: "https://x.co" }), li));
    expect(s[0].args).toMatchObject({
      author: "urn:li:person:abc",
      commentary: "New beans #coffee\n\nhttps://x.co",
      lifecycleState: "PUBLISHED",
    });
    const already = steps(
      planPublish(post({ caption: "See https://x.co", link: "https://x.co" }), li),
    );
    expect(already[0].args.commentary).toBe("See https://x.co");
  });

  it("hands LinkedIn pictures over as files", () => {
    const li = { platform: "linkedin" as const, destination: "urn:li:person:abc" };
    const s = steps(planPublish(post({ images: [IMG, "https://cdn.example.com/c.png"] }), li));
    expect(s[0].args.images).toEqual([
      { $file: { url: IMG, name: "image-1.jpg", mimetype: "image/jpeg" } },
      {
        $file: { url: "https://cdn.example.com/c.png", name: "image-2.png", mimetype: "image/png" },
      },
    ]);
  });

  it("uploads a LinkedIn video, then posts it, from a person only", () => {
    const li = { platform: "linkedin" as const, destination: "urn:li:person:abc" };
    const s = steps(planPublish(post({ video: VID }), li));
    expect(s.map((x) => x.tool)).toEqual(["LINKEDIN_UPLOAD_VIDEO", "LINKEDIN_CREATE_VIDEO_POST"]);
    expect(s[0].args).toEqual({ video_url: VID });
    expect(s[1].args.video_urn).toEqual({ $fromStep: 0 });
    const page = { platform: "linkedin" as const, destination: "urn:li:organization:9" };
    expect(planPublish(post({ video: VID }), page).ok).toBe(false);
  });

  it("uploads a YouTube video as a file with a clean title and tags", () => {
    const yt = { platform: "youtube" as const, destination: "UC1" };
    const s = steps(
      planPublish(post({ video: VID, caption: "Roast day <live>\nMore #coffee" }), yt),
    );
    expect(s).toHaveLength(1);
    expect(s[0].tool).toBe("YOUTUBE_UPLOAD_VIDEO");
    expect(s[0].args).toMatchObject({
      title: "Roast day live",
      tags: ["coffee"],
      privacyStatus: "public",
      videoFilePath: { $file: { url: VID, name: "video-1.mp4", mimetype: "video/mp4" } },
    });
    expect(planPublish(post({ images: [IMG] }), yt).ok).toBe(false);
  });

  it("makes a Pin from one picture with Pinterest's limits", () => {
    const pin = { platform: "pinterest" as const, destination: "board9" };
    const s = steps(
      planPublish(post({ images: [IMG], title: "t".repeat(150), caption: "c".repeat(900) }), pin),
    );
    expect(s[0].args).toMatchObject({
      board_id: "board9",
      media_source: { source_type: "image_url", url: IMG },
    });
    expect((s[0].args.title as string).length).toBe(100);
    expect((s[0].args.description as string).length).toBe(800);
    expect(planPublish(post({ images: [IMG, IMG2] }), pin).ok).toBe(false);
  });

  it("never sends Stories, non-https media or an unfinished account", () => {
    expect(
      planPublish(post({ images: [IMG], placement: "stories" }), {
        platform: "instagram",
        destination: "1",
      }).ok,
    ).toBe(false);
    expect(
      planPublish(post({ images: ["http://plain.example.com/a.jpg"] }), {
        platform: "facebook",
        destination: "p",
      }).ok,
    ).toBe(false);
    expect(
      planPublish(post({ images: [IMG] }), { platform: "instagram", destination: "" }).ok,
    ).toBe(false);
  });

  it("only plans tools that are on the app's allow-list, as writes", () => {
    const cases: [ComposioSocialPlatform, Partial<ComposioPost>][] = [
      ["instagram", { images: [IMG] }],
      ["instagram", { images: [IMG, IMG2] }],
      ["instagram", { video: VID }],
      ["facebook", {}],
      ["facebook", { images: [IMG] }],
      ["facebook", { images: [IMG, IMG2] }],
      ["facebook", { video: VID }],
      ["linkedin", {}],
      ["linkedin", { images: [IMG] }],
      ["linkedin", { video: VID }],
      ["pinterest", { images: [IMG] }],
      ["youtube", { video: VID }],
    ];
    for (const [platform, over] of cases) {
      const app = integrationApp(platform)!;
      const destination = platform === "linkedin" ? "urn:li:person:d" : "d";
      const plan = planPublish(post(over), { platform, destination });
      for (const step of steps(plan)) {
        const tool = allowedTool(app, step.tool);
        expect(tool, step.tool).not.toBeNull();
        // The create call is a write; the publish call after it too.
        expect(tool!.write, step.tool).toBe(true);
      }
    }
  });
});

describe("resolveArgs", () => {
  it("fills ids from earlier steps and stops when one is missing", () => {
    expect(resolveArgs({ a: 1, creation_id: { $fromStep: 0 } }, ["c1"])).toEqual({
      a: 1,
      creation_id: "c1",
    });
    expect(resolveArgs({ creation_id: { $fromStep: 0 } }, [null])).toBeNull();
  });
});

describe("resultId and postUrl", () => {
  it("reads the id at either level and prefers a Facebook post id", () => {
    expect(resultId({ id: "1" })).toBe("1");
    expect(resultId({ data: { id: "2" } })).toBe("2");
    expect(resultId({ id: "photo", post_id: "page_post" })).toBe("page_post");
    expect(resultId({ data: { id: 42 } })).toBe("42");
    expect(resultId({})).toBeNull();
    expect(resultId(null)).toBeNull();
  });

  it("links to the post where the id allows it", () => {
    expect(postUrl("facebook", "1_2")).toBe("https://www.facebook.com/1_2");
    expect(postUrl("pinterest", "99")).toBe("https://www.pinterest.com/pin/99/");
    expect(postUrl("linkedin", "urn:li:share:7")).toBe(
      "https://www.linkedin.com/feed/update/urn:li:share:7/",
    );
    expect(postUrl("linkedin", "7")).toBeNull();
    expect(postUrl("instagram", "1")).toBeNull();
  });
});
