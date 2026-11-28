// health.ts — what the Inbox can really do right now, from what is stored.
// Pure, no network. The Inbox shows it as "Setup check" so nobody believes
// Mox answers Instagram while no Instagram account was shared, or that a
// quick reply sends a DM while messages were never allowed.
import type { EngageHome, EngagePlatform } from "./contracts";

export type HealthState = "ok" | "warn" | "off";

export type HealthItem = {
  id: "facebook" | "instagram" | "messages" | "auto_reply" | "reading";
  state: HealthState;
  title: string;
  detail: string;
  /** Fixed by connecting again (the Meta sign-in). */
  reconnect: boolean;
};

/** A read older than this while the sweep should run means it is stuck. */
export const STALE_READ_MS = 30 * 60_000;

export function inboxHealth(data: EngageHome, now = Date.now()): HealthItem[] {
  const conn = data.connection;
  if (!conn) return [];
  const pages = data.pages;
  const ig = pages.filter((p) => p.hasInstagram);
  const igNames = ig.map((p) => p.igUsername).filter(Boolean) as string[];
  const liveDmRules = data.rules.filter((r) => r.status === "live" && r.dmEnabled);
  const dmWanted = (p: EngagePlatform) =>
    liveDmRules.some((r) => r.platforms.includes(p)) && !conn.canMessage[p];
  const items: HealthItem[] = [];

  items.push(
    pages.length
      ? {
          id: "facebook",
          state: "ok",
          title: `Facebook: ${pages.map((p) => p.pageName).join(", ")}`,
          detail: "Page comments and Messenger are answered.",
          reconnect: false,
        }
      : {
          id: "facebook",
          state: "off",
          title: "No Facebook Page shared",
          detail: "Reconnect and tick your Page.",
          reconnect: true,
        },
  );

  items.push(
    ig.length
      ? {
          id: "instagram",
          state: "ok",
          title: `Instagram: ${igNames.map((n) => `@${n}`).join(", ") || "connected"}`,
          detail: "Post and Reel comments are answered.",
          reconnect: false,
        }
      : {
          id: "instagram",
          state: "off",
          title: "Instagram isn't connected",
          detail:
            "Make it a Professional account, link it to your Facebook Page, then reconnect and tick it.",
          reconnect: true,
        },
  );

  const canIg = conn.canMessage.instagram;
  const canFb = conn.canMessage.facebook;
  items.push(
    canIg && canFb
      ? {
          id: "messages",
          state: "ok",
          title: "Private messages allowed",
          detail: "Mox answers DMs on Instagram and Messenger.",
          reconnect: false,
        }
      : {
          id: "messages",
          state: dmWanted("instagram") || dmWanted("facebook") ? "warn" : "off",
          title:
            canIg || canFb
              ? `Private messages only on ${canIg ? "Instagram" : "Facebook"}`
              : "Private messages not allowed",
          detail:
            liveDmRules.length > 0
              ? "A quick reply's DM is skipped. Reconnect and allow messages."
              : "Reconnect and allow messages.",
          reconnect: true,
        },
  );

  items.push(
    data.autoReply
      ? {
          id: "auto_reply",
          state: "ok",
          title: "Auto-reply on",
          detail: "Mox answers, asks what it doesn't know, leaves complaints to you.",
          reconnect: false,
        }
      : {
          id: "auto_reply",
          state: "off",
          title: "Auto-reply off",
          detail: "New comments wait for you.",
          reconnect: false,
        },
  );

  const working =
    data.autoReply || (data.automationsOn && data.rules.some((r) => r.status === "live"));
  const last = pages
    .map((p) => (p.syncedAt ? Date.parse(p.syncedAt) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  const pageError = pages.find((p) => p.lastError)?.lastError ?? null;
  if (conn.lastError || pageError)
    items.push({
      id: "reading",
      state: "warn",
      title: "Reading comments failed",
      detail: (conn.lastError ?? pageError)!,
      reconnect: conn.status !== "active",
    });
  else if (working && pages.length && (last === undefined || now - last > STALE_READ_MS))
    items.push({
      id: "reading",
      state: "warn",
      title: last === undefined ? "Not read yet" : "Comments weren't read lately",
      detail: "Press Refresh to read them now.",
      reconnect: false,
    });

  return items;
}

/** The one line the Inbox header shows about what is missing, or null. */
export function healthSummary(items: readonly HealthItem[]): string | null {
  const missing = items.filter((i) => i.state !== "ok" && i.id !== "auto_reply");
  if (!missing.length) return null;
  return missing.map((i) => i.title).join(" · ");
}
