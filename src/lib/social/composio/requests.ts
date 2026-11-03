// Composio publishing requests (ADR-0042, Phase 2). Pure and browser-safe:
// turns one post for one connected account into the exact tool calls to run,
// in order, or the plain reason it can't be sent this way.
//
// Argument names follow the live tool schemas (checked 2026-11-03 against
// GET /tools/<slug>, toolkit versions 20261101_00). Every slug here is on the
// app's allow-list in src/lib/integrations/catalog.ts.
//
// A tool that takes a file (LinkedIn pictures, a YouTube video) gets a
// `{ $file }` argument: the publisher puts that file in Composio's store just
// before the step runs and passes the stored file instead.
//
// Not sent through Composio, on purpose (the reason is returned):
//   Stories (Composio has no confirmed Story publishing),
//   LinkedIn video to a company page (LinkedIn allows it from a person only),
//   YouTube without a video,
//   Pinterest with more than one picture.

export type ComposioSocialPlatform =
  "instagram" | "facebook" | "linkedin" | "pinterest" | "youtube";

export const COMPOSIO_SOCIAL_PLATFORMS: readonly ComposioSocialPlatform[] = [
  "instagram",
  "facebook",
  "linkedin",
  "pinterest",
  "youtube",
];

export type ComposioPost = {
  caption: string;
  /** Public https links, in order (a carousel's slides). */
  images: string[];
  /** Public https link to an MP4. */
  video: string | null;
  link: string | null;
  title: string | null;
  placement: "feed" | "reels" | "stories";
};

/**
 * Where on the network the post goes, found when the account was connected:
 * the Instagram business account id, the Facebook Page id, the LinkedIn
 * author URN, the Pinterest board id or the YouTube channel id.
 */
export type ComposioTarget = { platform: ComposioSocialPlatform; destination: string };

/** An argument filled from an earlier step's result id. */
export type FromStep = { $fromStep: number };

/** A file to hand the tool: fetched from `url` and put in Composio's store first. */
export type FileArg = { $file: { url: string; name: string; mimetype: string } };

export type PlanStep = {
  tool: string;
  args: Record<string, unknown | FromStep | FileArg | FileArg[]>;
};

export function isFileArg(value: unknown): value is FileArg {
  return Boolean(value && typeof value === "object" && "$file" in (value as FileArg));
}

/** The file argument for a public link, named and typed from the link itself. */
export function fileFor(url: string, kind: "image" | "video", n = 0): FileArg {
  const ext = /\.(png|jpe?g|webp|gif|mp4|mov|webm)(?:$|\?)/i.exec(new URL(url).pathname)?.[1];
  const type = (ext ?? (kind === "video" ? "mp4" : "jpg")).toLowerCase();
  const mimetype =
    kind === "video"
      ? type === "mov"
        ? "video/quicktime"
        : type === "webm"
          ? "video/webm"
          : "video/mp4"
      : type === "png"
        ? "image/png"
        : type === "webp"
          ? "image/webp"
          : type === "gif"
            ? "image/gif"
            : "image/jpeg";
  const name = `${kind}-${n + 1}.${type === "jpeg" ? "jpg" : type}`;
  return { $file: { url, name, mimetype } };
}

export type PublishPlan = { ok: true; steps: PlanStep[] } | { ok: false; reason: string };

const IG_CAROUSEL_MAX = 10;
const FB_PHOTOS_MAX = 10;
// Instagram takes a while to process a Reel before it can be published.
const IG_IMAGE_WAIT_S = 60;
const IG_VIDEO_WAIT_S = 300;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function no(reason: string): PublishPlan {
  return { ok: false, reason };
}

/** The tool calls for one post to one account, or why it can't go this way. */
export function planPublish(post: ComposioPost, target: ComposioTarget): PublishPlan {
  if (!target.destination) return no("This account isn't finished connecting. Reconnect it.");
  const media = [...post.images, ...(post.video ? [post.video] : [])];
  if (media.some((url) => !isHttps(url))) return no("A picture or video has no public link.");
  if (post.placement === "stories") return no("Stories aren't sent this way yet.");
  switch (target.platform) {
    case "instagram":
      return instagram(post, target.destination);
    case "facebook":
      return facebook(post, target.destination);
    case "linkedin":
      return linkedin(post, target.destination);
    case "pinterest":
      return pinterest(post, target.destination);
    case "youtube":
      return youtube(post);
  }
}

const YT_TITLE_MAX = 100;
const YT_DESCRIPTION_MAX = 5000;

function youtube(post: ComposioPost): PublishPlan {
  if (!post.video) return no("YouTube takes videos only. Add a video to send this post there.");
  const firstLine =
    post.caption
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  // YouTube refuses < and > in titles and descriptions.
  const clean = (text: string) => text.replace(/[<>]/g, "");
  const title = clean(post.title?.trim() || firstLine || "New video").slice(0, YT_TITLE_MAX);
  const tags = [...post.caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]).slice(0, 15);
  const description = clean(
    post.link && !post.caption.includes(post.link)
      ? `${post.caption}\n\n${post.link}`
      : post.caption,
  ).slice(0, YT_DESCRIPTION_MAX);
  return {
    ok: true,
    steps: [
      {
        tool: "YOUTUBE_UPLOAD_VIDEO",
        args: {
          title,
          description,
          tags,
          // 22 = People & Blogs, YouTube's general category.
          categoryId: "22",
          privacyStatus: "public",
          videoFilePath: fileFor(post.video, "video"),
        },
      },
    ],
  };
}

function instagram(post: ComposioPost, igUserId: string): PublishPlan {
  // Instagram's create call reads the caption from the query string, so the
  // tool asks for "#" to be sent as "%23".
  const caption = post.caption.replace(/#/g, "%23");
  const publish = (wait: number): PlanStep => ({
    tool: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    args: { ig_user_id: igUserId, creation_id: { $fromStep: 0 }, max_wait_seconds: wait },
  });
  if (post.video) {
    if (post.images.length) return no("Instagram can't mix a video with pictures in one post.");
    return {
      ok: true,
      steps: [
        {
          tool: "INSTAGRAM_POST_IG_USER_MEDIA",
          args: {
            ig_user_id: igUserId,
            media_type: "REELS",
            video_url: post.video,
            caption,
            share_to_feed: true,
          },
        },
        publish(IG_VIDEO_WAIT_S),
      ],
    };
  }
  if (post.images.length === 0) return no("Every Instagram post needs a picture or video.");
  if (post.images.length > IG_CAROUSEL_MAX) {
    return no(`Instagram carousels take at most ${IG_CAROUSEL_MAX} pictures.`);
  }
  if (post.images.length === 1) {
    return {
      ok: true,
      steps: [
        {
          tool: "INSTAGRAM_POST_IG_USER_MEDIA",
          args: { ig_user_id: igUserId, image_url: post.images[0], caption },
        },
        publish(IG_IMAGE_WAIT_S),
      ],
    };
  }
  return {
    ok: true,
    steps: [
      {
        tool: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
        // The carousel tool takes the caption as written.
        args: { ig_user_id: igUserId, caption: post.caption, child_image_urls: post.images },
      },
      publish(IG_IMAGE_WAIT_S),
    ],
  };
}

function facebook(post: ComposioPost, pageId: string): PublishPlan {
  if (post.video) {
    if (post.images.length) return no("Facebook can't mix a video with pictures in one post.");
    return {
      ok: true,
      steps: [
        {
          tool: "FACEBOOK_CREATE_VIDEO_POST",
          args: {
            page_id: pageId,
            file_url: post.video,
            description: post.caption,
            ...(post.title ? { title: post.title.slice(0, 255) } : {}),
            published: true,
          },
        },
      ],
    };
  }
  if (post.images.length > FB_PHOTOS_MAX) {
    return no(`Facebook posts take at most ${FB_PHOTOS_MAX} pictures.`);
  }
  if (post.images.length > 1) {
    return {
      ok: true,
      steps: [
        {
          tool: "FACEBOOK_CREATE_MULTI_PHOTO_POST",
          args: { page_id: pageId, photo_urls: post.images, message: post.caption },
        },
      ],
    };
  }
  if (post.images.length === 1) {
    return {
      ok: true,
      steps: [
        {
          tool: "FACEBOOK_CREATE_PHOTO_POST",
          args: { page_id: pageId, url: post.images[0], message: post.caption, published: true },
        },
      ],
    };
  }
  if (!post.caption.trim() && !post.link) return no("This post has nothing to say.");
  return {
    ok: true,
    steps: [
      {
        tool: "FACEBOOK_CREATE_POST",
        args: {
          page_id: pageId,
          message: post.caption,
          ...(post.link ? { link: post.link } : {}),
          published: true,
        },
      },
    ],
  };
}

const LI_IMAGES_MAX = 20;
const LI_TEXT_MAX = 3000;

function linkedin(post: ComposioPost, author: string): PublishPlan {
  const text = (
    post.link && !post.caption.includes(post.link)
      ? `${post.caption}\n\n${post.link}`.trim()
      : post.caption
  ).slice(0, LI_TEXT_MAX);
  if (post.video) {
    if (post.images.length) return no("LinkedIn can't mix a video with pictures in one post.");
    if (!author.startsWith("urn:li:person:")) {
      return no("LinkedIn only takes video posts from a person, not a company page.");
    }
    return {
      ok: true,
      steps: [
        { tool: "LINKEDIN_UPLOAD_VIDEO", args: { video_url: post.video } },
        {
          tool: "LINKEDIN_CREATE_VIDEO_POST",
          args: {
            video_urn: { $fromStep: 0 },
            commentary: text,
            visibility: "PUBLIC",
            ...(post.title ? { title: post.title.slice(0, 200) } : {}),
          },
        },
      ],
    };
  }
  if (post.images.length > LI_IMAGES_MAX) {
    return no(`LinkedIn posts take at most ${LI_IMAGES_MAX} pictures.`);
  }
  if (!text.trim() && !post.images.length) return no("This post has nothing to say.");
  return {
    ok: true,
    steps: [
      {
        tool: "LINKEDIN_CREATE_LINKED_IN_POST",
        args: {
          author,
          commentary: text,
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
          ...(post.images.length
            ? { images: post.images.map((url, n) => fileFor(url, "image", n)) }
            : {}),
        },
      },
    ],
  };
}

function pinterest(post: ComposioPost, boardId: string): PublishPlan {
  if (post.video) return no("Pinterest videos aren't sent this way yet.");
  if (post.images.length !== 1) return no("Pinterest Pins are sent with one picture.");
  return {
    ok: true,
    steps: [
      {
        tool: "PINTEREST_CREATE_PIN",
        args: {
          board_id: boardId,
          media_source: { source_type: "image_url", url: post.images[0] },
          description: post.caption.slice(0, 800),
          ...(post.title ? { title: post.title.slice(0, 100) } : {}),
          ...(post.link ? { link: post.link.slice(0, 2048) } : {}),
        },
      },
    ],
  };
}

/** Fill `{ $fromStep: n }` arguments from the ids earlier steps returned. */
export function resolveArgs(
  args: PlanStep["args"],
  ids: readonly (string | null)[],
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value && typeof value === "object" && "$fromStep" in (value as FromStep)) {
      const id = ids[(value as FromStep).$fromStep];
      if (!id) return null;
      out[key] = id;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The id in a tool's result. Composio wraps some tools' output in `data`, so
 * both levels are read. A Facebook photo's post is `post_id`, not the photo.
 */
export function resultId(data: unknown): string | null {
  const inner = (data as { data?: unknown } | null)?.data;
  // YouTube's upload answers with the video under `response_data`.
  const nested = (value: unknown) => (value as { response_data?: unknown } | null)?.response_data;
  const levels = [data, inner, nested(data), nested(inner)];
  for (const level of levels) {
    if (!level || typeof level !== "object") continue;
    const record = level as Record<string, unknown>;
    // A LinkedIn video upload answers with `video_urn`; its post with `post_id`.
    for (const key of ["post_id", "id", "x_restli_id", "urn", "video_urn"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
      if (typeof value === "number") return String(value);
    }
  }
  return null;
}

/** Where a published post can be opened, when the network's id says so. */
export function postUrl(platform: ComposioSocialPlatform, id: string): string | null {
  switch (platform) {
    case "facebook":
      return `https://www.facebook.com/${encodeURIComponent(id)}`;
    case "linkedin":
      return id.startsWith("urn:li:") ? `https://www.linkedin.com/feed/update/${id}/` : null;
    case "pinterest":
      return `https://www.pinterest.com/pin/${encodeURIComponent(id)}/`;
    case "youtube":
      return `https://youtu.be/${encodeURIComponent(id)}`;
    default:
      // Instagram's link is read from the post afterwards (its id isn't the shortcode).
      return null;
  }
}
