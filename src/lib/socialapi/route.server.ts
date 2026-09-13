// route.server.ts — glue between the /api route kernel and the SocialAPI
// handlers: provider gate, per-workspace deps, and a Response that is valid for
// every status (a 204 must not carry a body).
import "server-only";
import { getAppUrl } from "@/server/env";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { DISTRIBUTION_DISABLED_MESSAGE } from "@/lib/sdr.handlers";
import {
  distributionErrorResponse,
  type HandlerResult,
  type SocialApiDeps,
} from "@/lib/socialapi/handlers";
import { getSocialApiDeps } from "@/lib/socialapi/workspace.server";

export function handlerResponse(out: HandlerResult): Response {
  if (out.status === 204 || out.body === null || out.body === undefined) {
    return new Response(null, { status: out.status === 200 ? 204 : out.status });
  }
  return Response.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}

export function distributionDisabledResponse(): Response {
  return Response.json(
    { error: { code: "DISTRIBUTION_DISABLED", detail: DISTRIBUTION_DISABLED_MESSAGE } },
    { status: 503 },
  );
}

/** Run a SocialAPI handler for a workspace whose active provider is SocialAPI. */
export async function withSocialApi(
  workspaceId: string,
  run: (deps: SocialApiDeps) => Promise<HandlerResult>,
): Promise<Response> {
  if (getDistributionProviderForWorkspace(workspaceId) !== "socialapi") {
    return distributionDisabledResponse();
  }
  try {
    return handlerResponse(await run(await getSocialApiDeps(workspaceId)));
  } catch (e) {
    return handlerResponse(distributionErrorResponse(e));
  }
}

export const CONNECT_CALLBACK_PATH = "/app/social/connected";

/**
 * Where the provider sends the user after consent. The browser's origin is
 * used only when it is this deployment's public origin (or localhost outside
 * production); anything else falls back to APP_URL, so a caller cannot point
 * the OAuth result at a foreign site.
 */
export function resolveConnectRedirect(origin: unknown): string {
  const appUrl = getAppUrl();
  let chosen = appUrl;
  if (typeof origin === "string" && origin) {
    try {
      const o = new URL(origin);
      const sameAsApp = o.origin === new URL(appUrl).origin;
      const localDev =
        process.env.NODE_ENV !== "production" &&
        o.protocol === "http:" &&
        (o.hostname === "localhost" || o.hostname === "127.0.0.1");
      if (sameAsApp || localDev) chosen = o.origin;
    } catch {
      /* invalid origin: keep APP_URL */
    }
  }
  return `${chosen}${CONNECT_CALLBACK_PATH}`;
}
