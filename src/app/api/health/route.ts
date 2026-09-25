import { NextResponse } from "next/server";
import { getImageModelConfigStatus } from "@/lib/model-router.server";
import { videoFallbackProvider, videoProvider } from "@/server/ugc/models.server";

export const dynamic = "force-dynamic";

const STARTED_AT = new Date().toISOString();

/** Which build is serving — lets a deploy be checked against the merged commit. No secrets. */
function version() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null;
  return {
    commit: sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12) : null,
    branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    startedAt: STARTED_AT,
    githubConnect: "oauth-first-v2",
  };
}

export function GET() {
  // Presence only — never the keys themselves.
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const kie = Boolean(process.env.KIE_API_KEY?.trim());
  const primary = videoProvider();
  const fallback = videoFallbackProvider();
  const videoReady =
    (primary === "kie" ? kie : openrouter) || (fallback === "openrouter" && openrouter);
  return NextResponse.json({
    status: openrouter ? "ok" : "degraded",
    version: version(),
    ai: { provider: "openrouter", configured: openrouter },
    image: { provider: "openrouter", ...getImageModelConfigStatus() },
    video: { provider: primary, fallback, kieConfigured: kie },
    services: {
      text: openrouter,
      imageGeneration: openrouter,
      imageToImage: openrouter,
      videoGeneration: videoReady,
    },
  });
}
