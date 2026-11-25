// reply.ts — the rules every comment reply follows. Pure.
//
// Mox drafts a reply (route engage.reply); this decides what the person sees
// and what may be sent:
//   * a sentence with a figure the brand never gave is left out;
//   * links other than the brand's own site are removed;
//   * it fits the network (Instagram replies are shorter);
//   * nothing is sent until a person presses Send (`sendableReply`).
import { withoutUnknownFacts } from "@/lib/autopilot/brief";
import { figuresKnown, keepOwnLinks } from "@/lib/community/reply";
import type { EngageDraft, EngagePlatform } from "./contracts";

/** Instagram allows 2,200 characters; a reply should be far shorter anyway. */
export const MAX_REPLY_CHARS: Record<EngagePlatform, number> = {
  instagram: 2_200,
  facebook: 8_000,
};

/** What Mox aims for: a comment reply, not an essay. */
export const DRAFT_TARGET_CHARS: Record<EngagePlatform, number> = {
  instagram: 300,
  facebook: 500,
};

export function finishEngageReply(
  draft: string,
  opts: { platform: EngagePlatform; brandDomain: string | null; facts: string },
): EngageDraft {
  const cleaned = keepOwnLinks(
    draft
      .replace(/\r/g, "")
      .replace(/^["'“]+|["'”]+$/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim(),
    opts.brandDomain ? [opts.brandDomain] : [],
  );
  let removed = 0;
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => {
      const kept = withoutUnknownFacts(p, (s) => figuresKnown(s, opts.facts));
      removed += kept.removed;
      return kept.text.replace(/[ \t]{2,}/g, " ").trim();
    })
    .filter(Boolean);
  let text = paragraphs.join("\n\n");
  const room = DRAFT_TARGET_CHARS[opts.platform] * 2;
  if (text.length > room) {
    const cut = text.slice(0, room);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    text = (end > room / 2 ? cut.slice(0, end + 1) : cut).trim();
  }
  return { text, removed };
}

/**
 * The text a person pressed Send on, or why it can't go. The person's own
 * words are theirs: only blank, too long or a link that isn't the brand's
 * own are refused.
 */
export function sendableReply(
  text: string,
  platform: EngagePlatform,
  brandDomain: string | null,
): { ok: true; text: string } | { ok: false; reason: string } {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return { ok: false, reason: "Write a reply first." };
  if (t.length > MAX_REPLY_CHARS[platform])
    return {
      ok: false,
      reason: `Too long for ${platform === "instagram" ? "Instagram" : "Facebook"} (${MAX_REPLY_CHARS[platform].toLocaleString("en")} characters at most).`,
    };
  if (keepOwnLinks(t, brandDomain ? [brandDomain] : []) !== t)
    return { ok: false, reason: "Only links to your own website can go in a reply." };
  return { ok: true, text: t };
}
