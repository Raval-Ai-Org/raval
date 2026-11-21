// Which provider connects and publishes each social network (ADR-0042, as
// amended 2026-11-18). Pure and browser-safe.
//
// Post for Me first, for every network it serves, whenever it is usable.
// Composio is the backup: for a network Post for Me doesn't serve (Pinterest),
// or while Post for Me is down (key refused, subscription ended), and only
// where Composio's sign-in really works. A person never sees either name.
//
// A network is "composio" here only once its app is connectable in the
// catalog. Existing Post for Me accounts keep publishing either way: the
// provider is per account (`social_accounts.provider`), never per workspace.
import { integrationApp, isConnectable } from "@/lib/integrations/catalog";
import { COMPOSIO_SOCIAL_PLATFORMS, type ComposioSocialPlatform } from "./composio/requests";

export type SocialProvider = "composio" | "postforme";

/**
 * Networks Composio can publish for (the backup): every one it can sign in to
 * without an app of Mellox's own. X, Threads and TikTok need one.
 */
export const COMPOSIO_PUBLISHING: readonly ComposioSocialPlatform[] = [
  "instagram",
  "facebook",
  "pinterest",
  "linkedin",
  "youtube",
];

export type RouteContext = {
  /** Integrations flag on and COMPOSIO_API_KEY set. */
  composioReady: boolean;
  /**
   * Post for Me configured and not paused (postforme-health.server.ts).
   * Absent means usable, so older callers keep Post for Me first.
   */
  postForMeReady?: boolean;
  /** The networks Post for Me serves (PROVIDER_PLATFORMS.postforme). */
  postForMePlatforms?: readonly string[];
  /** FEATURE_FLAG_INTEGRATIONS_TESTING for this workspace. */
  testing: boolean;
};

export type SocialRoute = { provider: SocialProvider; reason: string };

export function isComposioSocialPlatform(value: string): value is ComposioSocialPlatform {
  return (COMPOSIO_SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** Where a new connection for `platform` goes. */
export function routeSocialPlatform(platform: string, ctx: RouteContext): SocialRoute {
  const postForMeServes = ctx.postForMePlatforms
    ? ctx.postForMePlatforms.includes(platform)
    : platform !== "pinterest";
  if (postForMeServes && ctx.postForMeReady !== false) {
    return { provider: "postforme", reason: "Post for Me is the first choice." };
  }
  if (!isComposioSocialPlatform(platform)) {
    return { provider: "postforme", reason: "Composio can't connect this network." };
  }
  if (!COMPOSIO_PUBLISHING.includes(platform)) {
    return { provider: "postforme", reason: "Post for Me still sends more for this network." };
  }
  if (!ctx.composioReady) {
    return { provider: "postforme", reason: "Connected apps aren't set up." };
  }
  const app = integrationApp(platform);
  if (!app || app.method !== "composio" || !isConnectable(app, { testing: ctx.testing })) {
    return { provider: "postforme", reason: "Not checked on real accounts yet." };
  }
  return { provider: "composio", reason: "Connected through Composio." };
}

/**
 * The networks a workspace on Post for Me can connect: Post for Me's own list,
 * plus the ones only Composio publishes (Pinterest) once they route there.
 */
export function connectablePlatforms<T extends string>(
  postForMe: readonly T[],
  ctx: RouteContext,
): (T | ComposioSocialPlatform)[] {
  const withList = { ...ctx, postForMePlatforms: ctx.postForMePlatforms ?? postForMe };
  const extra = COMPOSIO_PUBLISHING.filter(
    (p) =>
      !(postForMe as readonly string[]).includes(p) &&
      routeSocialPlatform(p, withList).provider === "composio",
  );
  return [...postForMe, ...extra];
}
