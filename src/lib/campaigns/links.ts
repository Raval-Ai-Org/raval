// The campaign's link — the sign-up form, the shop page, the booking page —
// and how each channel carries it. Links are clickable in captions on
// LinkedIn, Facebook, X and Threads; on Instagram and TikTok they aren't, so
// the caption says where to find it and the person copies the link to their
// bio from the piece card.
// Pure: no I/O. The server also runs assertPublicUrl before saving.
import type { CampaignGoal, PlatformId } from "./contracts";
import { GOAL_LABELS } from "./contracts";

const CAPTION_LINK: ReadonlySet<string> = new Set(["linkedin", "facebook", "twitter", "threads"]);

export type LinkRule = { mode: "caption" | "bio" | "none"; line: string };

/** A link the person can share: https, a real host, no credentials. */
export function isShareableLink(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".local")) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

function linkName(goal: Pick<CampaignGoal, "kind" | "linkLabel">): string {
  if (goal.linkLabel.trim()) return goal.linkLabel.trim();
  switch (goal.kind) {
    case "registrations":
    case "signups":
      return "the sign-up link";
    case "sales":
      return "the shop link";
    case "bookings":
      return "the booking link";
    case "leads":
      return "the link";
    default:
      return "the link";
  }
}

/** How a piece on `platform` points people to the campaign's link. */
export function linkRule(
  platform: PlatformId | string,
  goal: Pick<CampaignGoal, "kind" | "link" | "linkLabel">,
  cta: "none" | "soft" | "link",
): LinkRule {
  if (!goal.link || !isShareableLink(goal.link) || cta === "none")
    return { mode: "none", line: "" };
  if (CAPTION_LINK.has(platform)) {
    return {
      mode: "caption",
      line: `End with one short call to action and this exact link on its own line: ${goal.link}`,
    };
  }
  return {
    mode: "bio",
    line: `Links don't work in ${platform === "tiktok" ? "TikTok" : "Instagram"} captions: point people to ${linkName(goal)} in the bio. Never write a web address in the caption.`,
  };
}

/** The call to action Studio gets (controls.cta, at most 140 characters). */
export function ctaFor(
  platform: PlatformId | string,
  goal: Pick<CampaignGoal, "kind" | "link" | "linkLabel">,
  cta: "none" | "soft" | "link",
): string | undefined {
  const rule = linkRule(platform, goal, cta);
  const verb: Record<string, string> = {
    registrations: "Save your spot",
    signups: "Sign up",
    sales: "Get yours",
    bookings: "Book now",
    leads: "Get in touch",
  };
  const action = verb[goal.kind] ?? "Find out more";
  if (rule.mode === "caption") return `${action}: ${goal.link}`.slice(0, 140);
  if (rule.mode === "bio") return `${action} — link in bio`.slice(0, 140);
  return undefined;
}

/** "Registrations: 340 of 1,000" — the person's own numbers, or nothing. */
export function goalLine(goal: CampaignGoal): { label: string; value: string | null } {
  const label = GOAL_LABELS[goal.kind];
  if (goal.count === null) return { label, value: null };
  const fmt = (n: number) => n.toLocaleString("en-US");
  return {
    label,
    value: goal.target ? `${fmt(goal.count)} of ${fmt(goal.target)}` : fmt(goal.count),
  };
}
