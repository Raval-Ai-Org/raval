import { NextResponse } from "next/server";
import { getKieConfigStatus } from "@/lib/kie-gateway.server";

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
  const kie = getKieConfigStatus();
  const imageReady = kie.configured && kie.image.defaultRouteConfigured;
  return NextResponse.json({
    status: imageReady ? "ok" : "degraded",
    version: version(),
    kie,
    services: {
      imageGeneration: imageReady,
      imageToImage: kie.configured && kie.image.imageToImageRouteConfigured,
    },
  });
}
