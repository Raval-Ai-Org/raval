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
          detail: "Comments on your Page's posts are read and answered.",
          reconnect: false,
        }
      : {
          id: "facebook",
          state: "off",
          title: "No Facebook Page shared",
          detail: "Connect again and tick your Facebook Page when Meta asks.",
          reconnect: true,
        },
  );

  items.push(
    ig.length
      ? {
          id: "instagram",
          state: "ok",
          title: `Instagram: ${igNames.map((n) => `@${n}`).join(", ") || "connected"}`,
          detail: "Comments on your Instagram posts and Reels are read and answered.",
          reconnect: false,
        }
      : {
          id: "instagram",
          state: "off",
          title: "Instagram isn't connected",
          detail:
            "Meta didn't share an Instagram account, so Instagram comments are never read. Your Instagram must be a Professional account linked to your Facebook Page. Then connect again and tick the Instagram account too.",
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
          detail:
            "Mox reads and answers DMs on Instagram and Messenger, and quick replies can send a link by DM to people who comment.",
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
              ? "Mox can't read or answer DMs, and a quick reply's DM is skipped (the public reply still goes). Connect again and allow messages."
              : "Mox can't read or answer DMs yet. Connect again and allow messages.",
          reconnect: true,
        },
  );

  items.push(
    data.autoReply
      ? {
          id: "auto_reply",
          state: "ok",
          title: "Auto-reply on",
          detail:
            "Mox answers new comments by itself, asks you what it doesn't know and leaves complaints to you.",
          reconnect: false,
        }
      : {
          id: "auto_reply",
          state: "off",
          title: "Auto-reply off",
          detail: "New comments wait for you. Turn it on and Mox answers them by itself.",
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
      detail: "Mellox reads new comments every few minutes. Press Refresh to read them now.",
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
