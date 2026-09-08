import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const QUERIES = [
  "artificial intelligence technology",
  "futuristic technology",
  "digital network data",
  "abstract software technology",
  "digital transformation",
];

type UnsplashPhoto = {
  id: string;
  imageUrl: string;
  photographerName: string;
  photographerUrl: string;
  unsplashUrl: string;
};

type UnsplashResponse = {
  id?: unknown;
  urls?: { raw?: unknown; regular?: unknown };
  user?: { name?: unknown; links?: { html?: unknown } };
  links?: { html?: unknown };
};

let cache: { expiresAt: number; photo: UnsplashPhoto } | undefined;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function addParams(rawUrl: string, params: Record<string, string>): string {
  const url = new URL(rawUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.photo, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" },
    });
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!accessKey) {
    return NextResponse.json({ error: "Unsplash is not configured" }, { status: 503 });
  }

  const endpoint = new URL("https://api.unsplash.com/photos/random");
  endpoint.searchParams.set("query", QUERIES[Math.floor(Math.random() * QUERIES.length)]);
  endpoint.searchParams.set("orientation", "landscape");
  endpoint.searchParams.set("content_filter", "high");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: controller.signal,
    });
    if (!response.ok)
      return NextResponse.json({ error: "Unsplash request failed" }, { status: 502 });

    const data = (await response.json()) as UnsplashResponse;
    const imageUrl = data.urls?.raw ?? data.urls?.regular;
    const photographerUrl = data.user?.links?.html;
    const unsplashUrl = data.links?.html;
    if (
      typeof data.id !== "string" ||
      !isHttpsUrl(imageUrl) ||
      typeof data.user?.name !== "string" ||
      !isHttpsUrl(photographerUrl) ||
      !isHttpsUrl(unsplashUrl)
    ) {
      return NextResponse.json({ error: "Invalid Unsplash response" }, { status: 502 });
    }

    const photo: UnsplashPhoto = {
      id: data.id,
      imageUrl: addParams(imageUrl, { auto: "format", fit: "crop", w: "1200", q: "82" }),
      photographerName: data.user.name,
      photographerUrl: addParams(photographerUrl, {
        utm_source: "mellox_ai",
        utm_medium: "referral",
      }),
      unsplashUrl: addParams(unsplashUrl, { utm_source: "mellox_ai", utm_medium: "referral" }),
    };
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, photo };
    return NextResponse.json(photo, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200" },
    });
  } catch (error) {
    console.error(
      "Unsplash fallback request failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({ error: "Unsplash request failed" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
