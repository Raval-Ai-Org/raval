import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const RECENT_LIMIT = 8;

const FALLBACK_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const FALLBACK_VIDEOS = [
  FALLBACK_VIDEO,
  "https://cdn.coverr.co/videos/coverr-man-working-in-front-of-a-computer-1569119350212/1080p.mp4",
  "https://cdn.coverr.co/videos/coverr-working-on-a-laptop-1564336888913/1080p.mp4",
  "https://cdn.coverr.co/videos/coverr-team-discussing-a-project-1562083779057/1080p.mp4",
  "https://cdn.coverr.co/videos/coverr-conference-call-1568736787014/1080p.mp4",
] as const;

const MELLOX_VIDEO_CATEGORIES = [
  {
    name: "AI",
    queries: [
      "artificial intelligence interface",
      "AI data visualization",
      "machine learning technology",
    ],
  },
  {
    name: "Marketing",
    queries: [
      "digital marketing analytics",
      "digital advertising strategy",
      "content marketing technology",
    ],
  },
  {
    name: "Analytics",
    queries: [
      "marketing analytics dashboard",
      "business data visualization",
      "performance analytics",
    ],
  },
  {
    name: "Growth",
    queries: ["business growth strategy", "startup growth analytics", "digital business growth"],
  },
  {
    name: "Automation",
    queries: [
      "AI business automation",
      "software workflow automation",
      "digital workflow technology",
    ],
  },
  {
    name: "Content",
    queries: [
      "content creation technology",
      "creative digital workspace",
      "digital media production",
    ],
  },
  {
    name: "Future",
    queries: [
      "future of marketing technology",
      "AI business future",
      "digital transformation strategy",
    ],
  },
] as const;

type Category = (typeof MELLOX_VIDEO_CATEGORIES)[number];

type PexelsVideo = {
  id: number;
  videoUrl: string;
  creatorName: string;
  creatorUrl: string;
  pexelsUrl: string;
  provider: "Pexels" | "Raval AI";
  category: string;
  query: string;
  cachedAt: string;
};

type PexelsFile = {
  file_type?: unknown;
  width?: unknown;
  height?: unknown;
  link?: unknown;
};

type PexelsResult = {
  id?: unknown;
  url?: unknown;
  duration?: unknown;
  user?: { name?: unknown; url?: unknown };
  video_files?: PexelsFile[];
};

type PexelsResponse = { videos?: PexelsResult[] };

const categoryCache = new Map<string, { expiresAt: number; videos: PexelsVideo[] }>();
const recentlyUsedVideoIds: number[] = [];

function isPlayableVideo(video: PexelsVideo | null | undefined): video is PexelsVideo {
  return (
    !!video &&
    Number.isFinite(video.id) &&
    typeof video.videoUrl === "string" &&
    /^https?:\/\//i.test(video.videoUrl)
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function getCategory(value: string | null): Category {
  return (
    MELLOX_VIDEO_CATEGORIES.find((category) => category.name === value) ??
    MELLOX_VIDEO_CATEGORIES[0]
  );
}

function selectVideoFile(
  files: PexelsFile[] | undefined,
): { link: string; width: number; height: number } | null {
  const candidates = (files ?? [])
    .filter(
      (file) =>
        file.file_type === "video/mp4" &&
        isHttpsUrl(file.link) &&
        typeof file.width === "number" &&
        typeof file.height === "number" &&
        file.width > file.height,
    )
    .sort((a, b) => {
      const aWidth = a.width as number;
      const bWidth = b.width as number;
      const aPreferred = aWidth >= 720 && aWidth <= 1920;
      const bPreferred = bWidth >= 720 && bWidth <= 1920;
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return Math.abs(aWidth - 1280) - Math.abs(bWidth - 1280);
    });

  const file = candidates[0];
  return file && isHttpsUrl(file.link)
    ? { link: file.link, width: file.width as number, height: file.height as number }
    : null;
}

function scoreVideo(
  video: PexelsResult,
  file: { width: number; height: number },
  category: Category,
) {
  let score = 0;
  if (file.width >= 1280) score += 2;
  if (file.width > file.height) score += 2;
  if (typeof video.duration === "number" && video.duration >= 12) score += 1;
  if (["AI", "Marketing", "Analytics"].includes(category.name)) score += 3;
  if (typeof video.id === "number" && recentlyUsedVideoIds.includes(video.id)) score -= 10;
  return score;
}

function rememberVideo(id: number) {
  const existing = recentlyUsedVideoIds.indexOf(id);
  if (existing >= 0) recentlyUsedVideoIds.splice(existing, 1);
  recentlyUsedVideoIds.push(id);
  while (recentlyUsedVideoIds.length > RECENT_LIMIT) recentlyUsedVideoIds.shift();
}

function buildFallbackVideo(category: Category): PexelsVideo {
  const selected = FALLBACK_VIDEOS[Math.floor(Math.random() * FALLBACK_VIDEOS.length)];
  return {
    id: Date.now() + Math.floor(Math.random() * 100000),
    videoUrl: selected,
    creatorName: "Raval AI",
    creatorUrl: "https://raval.ai",
    pexelsUrl: "https://raval.ai",
    provider: "Raval AI",
    category: category.name,
    query: category.queries[0],
    cachedAt: new Date().toISOString(),
  };
}

function response(video: PexelsVideo) {
  return NextResponse.json(video, {
    headers: { "Cache-Control": "public, max-age=1800, stale-while-revalidate=3600" },
  });
}

export async function GET(request: Request) {
  const category = getCategory(new URL(request.url).searchParams.get("category"));
  const cached = categoryCache.get(category.name);
  if (cached && cached.expiresAt > Date.now() && cached.videos.length > 0) {
    const available = cached.videos.filter((video) => !recentlyUsedVideoIds.includes(video.id));
    const pool = available.length > 0 ? available : cached.videos;
    const video = pool[Math.floor(Math.random() * pool.length)];
    rememberVideo(video.id);
    return response(video);
  }

  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) {
    const fallback = buildFallbackVideo(category);
    return response({
      ...fallback,
      videoUrl: FALLBACK_VIDEO,
      creatorName: "MDN",
      creatorUrl: "https://developer.mozilla.org",
      pexelsUrl: "https://developer.mozilla.org/",
    });
  }

  const query = category.queries[Math.floor(Math.random() * category.queries.length)];
  const endpoint = new URL("https://api.pexels.com/videos/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("orientation", "landscape");
  endpoint.searchParams.set("size", "medium");
  endpoint.searchParams.set("per_page", "15");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const apiResponse = await fetch(endpoint, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });
    if (!apiResponse.ok) {
      const fallback = buildFallbackVideo(category);
      return response({
        ...fallback,
        videoUrl: FALLBACK_VIDEO,
        creatorName: "MDN",
        creatorUrl: "https://developer.mozilla.org",
        pexelsUrl: "https://developer.mozilla.org/",
      });
    }

    const data = (await apiResponse.json()) as PexelsResponse;
    const candidates = (data.videos ?? [])
      .map((video) => {
        const file = selectVideoFile(video.video_files);
        if (
          !file ||
          typeof video.id !== "number" ||
          !isHttpsUrl(video.url) ||
          typeof video.user?.name !== "string" ||
          !isHttpsUrl(video.user.url)
        )
          return null;
        return { video, file, score: scoreVideo(video, file, category) };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (candidates.length === 0) {
      const fallback = buildFallbackVideo(category);
      return response({
        ...fallback,
        videoUrl: FALLBACK_VIDEO,
        creatorName: "MDN",
        creatorUrl: "https://developer.mozilla.org",
        pexelsUrl: "https://developer.mozilla.org/",
      });
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    const now = new Date().toISOString();
    const videos = candidates.map(({ video, file }) => ({
      id: video.id as number,
      videoUrl: file.link,
      creatorName: video.user?.name as string,
      creatorUrl: video.user?.url as string,
      pexelsUrl: video.url as string,
      provider: "Pexels" as const,
      category: category.name,
      query,
      cachedAt: now,
    }));
    categoryCache.set(category.name, { expiresAt: Date.now() + CACHE_TTL_MS, videos });
    rememberVideo(selected.video.id as number);
    return response(videos.find((video) => video.id === selected.video.id) ?? videos[0]);
  } catch (error) {
    console.error(
      "Pexels background request failed",
      error instanceof Error ? error.message : "unknown error",
    );
    const fallback = buildFallbackVideo(category);
    return response({
      ...fallback,
      videoUrl: FALLBACK_VIDEO,
      creatorName: "MDN",
      creatorUrl: "https://developer.mozilla.org",
      pexelsUrl: "https://developer.mozilla.org/",
    });
  } finally {
    clearTimeout(timeout);
  }
}
