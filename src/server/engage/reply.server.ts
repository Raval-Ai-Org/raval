// reply.server.ts — Mox's draft reply to one comment (route engage.reply).
// Called inside runMetered by the server fn, after the role check. Brand
// facts, memory and voice come from the verified workspace id; the comment
// and the post are untrusted data. Nothing is sent: a person reads the draft,
// changes it and presses Send.
import "server-only";
import { llmText } from "@/lib/ai-gateway.server";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { memoryBlockFor } from "@/server/memory/context.server";
import { lookTextFor } from "@/server/brand-look/resolve.server";
import { loadCommunityBrand } from "@/server/community/context.server";
import { PLATFORM_LABEL, type EngageDraft, type EngagePlatform } from "@/lib/engage/contracts";
import { DRAFT_TARGET_CHARS, finishEngageReply } from "@/lib/engage/reply";

const SYSTEM = `You write the brand's reply to a comment someone left on the brand's own social media post. A person on the brand's team will read it, change it if needed and send it themselves.
Rules:
- Answer what the comment says or asks, warmly and directly, like a real person who runs the account.
- Short: one to three sentences. No hashtags. At most one emoji, and only if the brand's voice uses them.
- Never invent prices, dates, numbers, stock, results or promises. Use only facts from BRAND FACTS. If the answer isn't there, say you'll get back to them or invite them to send a message.
- If the comment is rude or spam, write a calm, polite line or nothing at all.
- Never ask for personal details (phone, email, address, payment) in a public reply; invite a private message instead.
- No links except the brand's own website, and only if it truly helps.
- Reply with the text of the reply only.
${UNTRUSTED_DATA_RULE}`;

export async function draftEngageReply(args: {
  workspaceId: string;
  platform: EngagePlatform;
  comment: { body: string; authorName: string | null; postCaption: string | null };
  note?: string;
}): Promise<EngageDraft & { brandDomain: string | null }> {
  const [brand, memory, voice] = await Promise.all([
    loadCommunityBrand(args.workspaceId),
    memoryBlockFor(args.workspaceId, "text").catch(() => ""),
    lookTextFor(args.workspaceId, "comment-reply"),
  ]);
  const user = [
    memory,
    `BRAND: ${brand.brandName}`,
    `BRAND FACTS (the only facts you may state about the brand):\n${brand.facts || "(none saved yet)"}`,
    voice && `HOW THE BRAND SOUNDS:\n${voice}`,
    `WHERE: a comment on the brand's ${PLATFORM_LABEL[args.platform]} post. Aim for under ${DRAFT_TARGET_CHARS[args.platform]} characters.`,
    args.comment.postCaption &&
      `THE BRAND'S POST:\n${wrapUntrusted("post-caption", args.comment.postCaption, {
        maxChars: 1_500,
        route: "engage.reply",
      })}`,
    `THE COMMENT${args.comment.authorName ? ` (from ${args.comment.authorName.slice(0, 60)})` : ""}:\n${wrapUntrusted(
      "social-comment",
      args.comment.body,
      { maxChars: 2_000, route: "engage.reply" },
    )}`,
    args.note && `WHAT THE TEAM WANTS IN THIS REPLY (their own words):\n${args.note.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await llmText({
    route: "engage.reply",
    system: SYSTEM,
    user,
    maxTokens: 1_000,
    timeoutMs: 45_000,
    retries: 1,
  });
  const finished = finishEngageReply(out.text, {
    platform: args.platform,
    brandDomain: brand.domain,
    // Figures the comment or the post already state may be repeated back.
    facts: `${brand.facts}\n${args.comment.body}\n${args.comment.postCaption ?? ""}\n${args.note ?? ""}`,
  });
  return { ...finished, brandDomain: brand.domain };
}

/** The brand's own site, for the send check. */
export async function brandDomainFor(workspaceId: string): Promise<string | null> {
  return (await loadCommunityBrand(workspaceId)).domain;
}
