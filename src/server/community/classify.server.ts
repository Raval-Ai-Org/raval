// classify.server.ts — one economy call that labels and summarises the
// threads a refresh found (route community.classify, included). The threads
// are wrapped as untrusted data; groundClassification keeps the answer to the
// numbered results it was given.
import "server-only";
import { llmJson } from "@/lib/ai-gateway.server";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import {
  CLASSIFY_SCHEMA,
  groundClassification,
  type ClassifiedThread,
} from "@/lib/community/classify";
import { SOURCE_LABELS } from "@/lib/community/contracts";
import type { RawThread } from "@/lib/community/threads";

const BATCH = 30;

const SYSTEM = `You sort online discussions for a brand's marketing team.
For each numbered thread decide:
- "kind": "problem" when someone describes or asks about a problem the brand solves; "alternative" when someone wants to replace a product (name it in "competitor"); "competitor" when a listed competitor is discussed; "category" when it is general talk about the brand's field.
- "relevance": 0-100, how useful it would be for the brand to add a helpful reply. Under 40 means off-topic, spam, a job post, or a thread the brand has no business in.
- "summary": one plain sentence saying what the person wants. Only use what the thread text says. No links.
- "competitor": exactly one name from the competitor list, or "".
Judge only the threads given. Never add a thread, a company or a fact.
${UNTRUSTED_DATA_RULE}`;

export async function classifyThreads(args: {
  threads: RawThread[];
  brandLine: string;
  competitors: string[];
}): Promise<ClassifiedThread[]> {
  const out: ClassifiedThread[] = [];
  for (let start = 0; start < args.threads.length; start += BATCH) {
    const batch = args.threads.slice(start, start + BATCH);
    const list = batch
      .map(
        (t, i) =>
          `[${i}] (${SOURCE_LABELS[t.source]}, ${t.community}) ${t.title}\n${t.snippet.slice(0, 400)}`,
      )
      .join("\n\n");
    let answer: { threads?: unknown } | null = null;
    try {
      answer = await llmJson<{ threads?: unknown }>({
        route: "community.classify",
        system: SYSTEM,
        user: `BRAND:\n${args.brandLine || "(not filled in yet)"}\n\nCOMPETITORS: ${
          args.competitors.join(", ") || "(none tracked)"
        }\n\nTHREADS:\n${wrapUntrusted("community-threads", list, {
          maxChars: 14_000,
          route: "community.classify",
        })}`,
        outputSchema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: 4_000,
        timeoutMs: 45_000,
        retries: 1,
        fallback: { threads: [] },
      });
    } catch (error) {
      // Unclassified threads still show, on the query's own reason.
      console.warn("[community] classify failed", error instanceof Error ? error.message : error);
    }
    out.push(...groundClassification(batch, answer, args.competitors));
  }
  return out;
}
