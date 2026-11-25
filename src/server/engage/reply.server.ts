// reply.server.ts — Mox's reply to one comment: a draft a person asks for
// (route engage.reply) or the auto-reply decision (route engage.auto). Brand
// facts, the team's rules, answers, memory and voice come from the verified
// workspace id; the comment and the post are untrusted data.
import "server-only";
import { llmJson, llmText } from "@/lib/ai-gateway.server";
import { parseDecision } from "@/lib/engage/auto-reply";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { memoryBlockFor } from "@/server/memory/context.server";
import { lookTextFor } from "@/server/brand-look/resolve.server";
import { loadCommunityBrand } from "@/server/community/context.server";
import { PLATFORM_LABEL, type EngageDraft, type EngagePlatform } from "@/lib/engage/contracts";
import { DRAFT_TARGET_CHARS, finishEngageReply } from "@/lib/engage/reply";
import {
  KEEP_EXAMPLES,
  answersBlock,
  answersFacts,
  examplesBlock,
  type EngageAnswer,
  type EngageExample,
} from "@/lib/engage/training";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as SupabaseClient;

/** What the team taught Mox (Train Mox), read by the verified workspace id. */
async function trainingFor(workspaceId: string) {
  const [answers, examples] = await Promise.all([
    db
      .from("engage_knowledge")
      .select("id,question,answer,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(100),
    db
      .from("engage_examples")
      .select("id,platform,comment,reply,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(KEEP_EXAMPLES),
  ]);
  return {
    answers: (
      (answers.data ?? []) as { id: string; question: string; answer: string; updated_at: string }[]
    ).map((a): EngageAnswer => ({
      id: a.id,
      question: a.question,
      answer: a.answer,
      updatedAt: a.updated_at,
    })),
    examples: (
      (examples.data ?? []) as {
        id: string;
        platform: EngagePlatform;
        comment: string;
        reply: string;
        created_at: string;
      }[]
    ).map((e): EngageExample => ({
      id: e.id,
      platform: e.platform,
      comment: e.comment,
      reply: e.reply,
      createdAt: e.created_at,
    })),
  };
}

const SYSTEM = `You write the brand's reply to a comment someone left on the brand's own social media post. A person on the brand's team will read it, change it if needed and send it themselves.
Rules:
- Answer what the comment says or asks, warmly and directly, like a real person who runs the account.
- Short: one to three sentences. No hashtags. At most one emoji, and only if the brand's voice uses them.
- Never invent prices, dates, numbers, stock, results or promises. Use only facts from BRAND FACTS and TEAM ANSWERS. When a TEAM ANSWER fits the question, use it.
- PAST REPLIES only show how the team sounds; never copy their facts to a different question. If the answer isn't there, say you'll get back to them or invite them to send a message.
- If the comment is rude or spam, write a calm, polite line or nothing at all.
- Never ask for personal details (phone, email, address, payment) in a public reply; invite a private message instead.
- No links except the brand's own website, and only if it truly helps.
- Reply with the text of the reply only.
${UNTRUSTED_DATA_RULE}`;

type ReplyArgs = {
  workspaceId: string;
  platform: EngagePlatform;
  comment: { body: string; authorName: string | null; postCaption: string | null };
  /** What the team wants in this reply (a person's draft request). */
  note?: string;
  /** The matched automation's instructions, written by the team. */
  guidance?: string | null;
};

/** The team's standing instructions for every reply (Inbox or chat). */
async function guidelinesFor(workspaceId: string): Promise<string> {
  const { data } = await db
    .from("engage_settings")
    .select("guidelines")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return ((data as { guidelines?: string } | null)?.guidelines ?? "").slice(0, 3_000);
}

/** Everything Mox knows for one comment, read by the verified workspace id. */
async function replyContext(args: ReplyArgs, route: string) {
  const [brand, memory, voice, training, guidelines] = await Promise.all([
    loadCommunityBrand(args.workspaceId),
    memoryBlockFor(args.workspaceId, "text").catch(() => ""),
    lookTextFor(args.workspaceId, "comment-reply"),
    trainingFor(args.workspaceId).catch(() => ({ answers: [], examples: [] })),
    guidelinesFor(args.workspaceId).catch(() => ""),
  ]);
  const answers = answersBlock(training.answers);
  const examples = examplesBlock(training.examples, args.platform);
  const user = [
    memory,
    `BRAND: ${brand.brandName}`,
    `BRAND FACTS (the only facts you may state about the brand):\n${brand.facts || "(none saved yet)"}`,
    voice && `HOW THE BRAND SOUNDS:\n${voice}`,
    answers &&
      `TEAM ANSWERS (questions people ask and the team's own answers; facts you may use):\n${answers}`,
    examples && `PAST REPLIES THE TEAM SENT (voice only):\n${examples}`,
    guidelines && `THE TEAM'S RULES FOR EVERY REPLY (their own words; follow them):\n${guidelines}`,
    args.guidance &&
      `THIS AUTOMATION'S INSTRUCTIONS (from the team):\n${args.guidance.slice(0, 1_000)}`,
    `WHERE: a comment on the brand's ${PLATFORM_LABEL[args.platform]} post. Aim for under ${DRAFT_TARGET_CHARS[args.platform]} characters.`,
    args.comment.postCaption &&
      `THE BRAND'S POST:\n${wrapUntrusted("post-caption", args.comment.postCaption, {
        maxChars: 1_500,
        route,
      })}`,
    `THE COMMENT${args.comment.authorName ? ` (from ${args.comment.authorName.slice(0, 60)})` : ""}:\n${wrapUntrusted(
      "social-comment",
      args.comment.body,
      { maxChars: 2_000, route },
    )}`,
    args.note && `WHAT THE TEAM WANTS IN THIS REPLY (their own words):\n${args.note.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Figures the comment or the post already state may be repeated back.
  const facts = [
    brand.facts,
    answersFacts(training.answers),
    guidelines,
    args.guidance ?? "",
    args.comment.body,
    args.comment.postCaption ?? "",
    args.note ?? "",
  ].join("\n");
  return { brand, user, facts };
}

export async function draftEngageReply(
  args: ReplyArgs,
): Promise<EngageDraft & { brandDomain: string | null }> {
  const ctx = await replyContext(args, "engage.reply");
  const out = await llmText({
    route: "engage.reply",
    system: SYSTEM,
    user: ctx.user,
    maxTokens: 1_000,
    timeoutMs: 45_000,
    retries: 1,
  });
  const finished = finishEngageReply(out.text, {
    platform: args.platform,
    brandDomain: ctx.brand.domain,
    facts: ctx.facts,
  });
  return { ...finished, brandDomain: ctx.brand.domain };
}

const DECIDE_SYSTEM = `You run the brand's comment replies on its own social media posts, by yourself. For each comment you decide what to do, and a reply is posted publicly without a person checking it, so be careful.
Choose one action:
- "reply": you can answer well with what you know (BRAND FACTS, TEAM ANSWERS, THE TEAM'S RULES), or the comment needs no facts (praise, thanks, an emoji, a friend tagged, a hello). Write the reply.
- "ask": the comment asks something specific only the brand can answer (a price, a size, stock, a date, delivery to a place, opening hours, a policy) and the answer is NOT in what you know. Do not guess and do not reply. Write the question for the team, short and general so the answer can be reused ("What is the price of the cardamom cold brew?").
- "person": a complaint, an angry customer, a refund or order problem, health, legal or safety, anything private, or anything you are unsure about.
- "skip": spam, scams, bots, or nothing a reply would fit.
Reply rules:
- Warm and direct, like the person who runs the account. One or two short sentences. No hashtags. At most one emoji, and only if the brand's voice uses them.
- Never invent prices, dates, numbers, stock, results or promises. Only facts from BRAND FACTS, TEAM ANSWERS and THE TEAM'S RULES.
- PAST REPLIES only show the voice; never copy their facts to a different question.
- Never ask for phone, email, address or payment in public; invite a private message instead.
- No links except the brand's own website, and only if it truly helps.
- Reply in the language and script the comment is written in.
Answer with JSON only: {"action":"reply"|"ask"|"person"|"skip","reply":string|null,"question":string|null,"why":string}. "why" is a few plain words for the team.
${UNTRUSTED_DATA_RULE}`;

/**
 * Auto-reply (route engage.auto): Mox decides and, for a reply, writes it.
 * What happens next is pure (`autoOutcome`, src/lib/engage/auto-reply.ts).
 */
export async function decideEngageReply(args: ReplyArgs) {
  const ctx = await replyContext(args, "engage.auto");
  const raw = await llmJson<unknown>({
    route: "engage.auto",
    fallback: { action: "person", why: "Mox couldn't decide." },
    system: DECIDE_SYSTEM,
    user: ctx.user,
    maxTokens: 1_200,
    timeoutMs: 45_000,
    retries: 1,
  });
  const decision = parseDecision(raw);
  const finished = decision.reply
    ? finishEngageReply(decision.reply, {
        platform: args.platform,
        brandDomain: ctx.brand.domain,
        facts: ctx.facts,
      })
    : null;
  return { decision, finished, brandDomain: ctx.brand.domain };
}

/** The brand's own site, for the send check. */
export async function brandDomainFor(workspaceId: string): Promise<string | null> {
  return (await loadCommunityBrand(workspaceId)).domain;
}
