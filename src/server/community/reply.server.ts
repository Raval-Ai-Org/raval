// reply.server.ts — one reply draft for one thread (route community.reply).
// Called inside runMetered by the server fn, after the role check. The brand
// facts, memory and voice come from the verified workspace id; the thread is
// untrusted data. finishReply decides what the person sees: no unknown
// figures, no foreign links, and a disclosure when the brand is named.
import "server-only";
import { llmText } from "@/lib/ai-gateway.server";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { memoryBlockFor } from "@/server/memory/context.server";
import { lookTextFor } from "@/server/brand-look/resolve.server";
import {
  SOURCE_LABELS,
  type CommunityReply,
  type CommunityThreadView,
} from "@/lib/community/contracts";
import { MAX_REPLY_CHARS, finishReply } from "@/lib/community/reply";
import { loadCommunityBrand } from "./context.server";

const SYSTEM = `You help a brand's team write a reply to a public online discussion. A person on the team will read it, change it and post it themselves.
Rules:
- Be genuinely helpful first. Answer the question or problem directly with practical advice anyone could use, even if they never buy anything.
- Mention the brand at most once, only where it truly fits the question, and never as an advert. If it doesn't fit, don't mention it.
- If you mention the brand, say plainly that the writer works there.
- Never invent numbers, prices, results, customers or quotes. Use only facts from BRAND FACTS.
- Never criticise or name a competitor unless the thread already names it, and then stay fair.
- No links except the brand's own website, and only if it helps.
- Write like a person in that community: plain words, no hashtags, no emoji, no marketing phrases, no headings.
- Reply with the text of the reply only.
${UNTRUSTED_DATA_RULE}`;

export async function draftCommunityReply(args: {
  workspaceId: string;
  thread: CommunityThreadView;
  note?: string;
}): Promise<CommunityReply> {
  const [brand, memory, voice] = await Promise.all([
    loadCommunityBrand(args.workspaceId),
    memoryBlockFor(args.workspaceId, "text").catch(() => ""),
    lookTextFor(args.workspaceId, "community-reply"),
  ]);
  const t = args.thread;
  const limit = MAX_REPLY_CHARS[t.source];
  const user = [
    memory,
    `BRAND FACTS (the only facts you may state about the brand):\n${brand.facts || "(none saved yet)"}`,
    voice && `HOW THE BRAND SOUNDS:\n${voice}`,
    `WHERE: ${SOURCE_LABELS[t.source]} — ${t.community}. Keep it under ${limit} characters.`,
    `THE THREAD:\n${wrapUntrusted("community-thread", `${t.title}\n\n${t.snippet}`, {
      maxChars: 3_000,
      route: "community.reply",
    })}`,
    args.note && `WHAT THE TEAM WANTS IN THIS REPLY (their own words):\n${args.note.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await llmText({
    route: "community.reply",
    system: SYSTEM,
    user,
    maxTokens: 2_000,
    timeoutMs: 45_000,
    retries: 1,
  });
  const finished = finishReply(out.text, {
    brandName: brand.brandName,
    brandDomain: brand.domain,
    source: t.source,
    // Figures the thread itself states may be repeated back.
    facts: `${brand.facts}\n${t.title}\n${t.snippet}\n${args.note ?? ""}`,
  });
  return { ...finished, createdAt: new Date().toISOString() };
}
