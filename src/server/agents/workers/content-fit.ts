// content-fit.ts — the approval-gated Content-Fit Worker (audit §29.3, L1/L2).
//
// For one content item it runs the deterministic checks first — the platform's
// authoritative limits (the same table the distribution pre-validation uses)
// and the output guardrails (PII, claims, profanity, brand don'ts) — and, only
// when something needs fixing, asks the model for a revised draft that
// resolves exactly those issues. The revision is proposed as a
// `content.apply_revision` action request: the user sees a before/after diff
// and nothing changes until they approve it.
import "server-only";
import { z } from "zod";
import { PLATFORM_LIMITS, validateContentForPlatform } from "@/lib/sdr.server";
import { checkOutput } from "@/server/guardrails/output-check";
import type { WorkerDefinition } from "../runtime";

/** content_items.channel → distribution platform id (where limits are known). */
const PLATFORM_BY_CHANNEL: Record<string, keyof typeof PLATFORM_LIMITS> = {
  x: "twitter",
  twitter: "twitter",
  linkedin: "linkedin",
  facebook: "facebook",
  instagram: "instagram",
};

export type FitIssue = { rule: string; message: string; severity: "warn" | "block" };

/** Pure: the deterministic issues for an item. Exported for tests/evals. */
export function contentFitIssues(item: {
  channel: string | null;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  media_url: string | null;
}): FitIssue[] {
  const issues: FitIssue[] = [];
  const platform = item.channel ? PLATFORM_BY_CHANNEL[item.channel] : undefined;
  const text = [item.body ?? "", (item.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  if (platform) {
    for (const message of validateContentForPlatform(platform, {
      text,
      mediaUrls: item.media_url ? [item.media_url] : [],
    })) {
      issues.push({ rule: `platform:${platform}`, message, severity: "block" });
    }
  }
  if (!item.body?.trim()) issues.push({ rule: "empty_body", message: "The post has no body copy.", severity: "block" });
  for (const f of checkOutput(`${item.title ?? ""}\n${item.body ?? ""}`).findings) {
    issues.push({ rule: `${f.kind}:${f.rule}`, message: `Flagged ${f.rule.replace(/_/g, " ")}: “${f.snippet}”`, severity: f.severity });
  }
  return issues;
}

const RevisionSchema = z.object({
  title: z.string().max(280).optional(),
  body: z.string().min(1).max(8000),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
});

export const contentFitWorker: WorkerDefinition = {
  name: "content-fit",
  objective: "Check one content item against platform rules and brand safety; propose a fix for approval.",
  budget: { maxSteps: 6, deadlineMs: 60_000, maxCostUsd: 0.05 },
  async run(ctx) {
    const contentItemId = String(ctx.input.contentItemId ?? "");
    const got = await ctx.tool<{
      id: string;
      channel: string | null;
      kind: string;
      status: string;
      title: string | null;
      body: string | null;
      hashtags: string[] | null;
      media_url: string | null;
    }>("content.get", { id: contentItemId });
    if (got.status !== "ok") throw new Error("content.get unexpectedly required approval");
    const item = got.output;
    const issues = contentFitIssues(item);
    // Media rules can't be fixed by rewriting copy; only text issues get a proposal.
    const fixable = issues.filter((i) => !/media/i.test(i.message));
    if (!fixable.length) {
      return { summary: issues.length ? `Only media issues: ${issues.map((i) => i.message).join(" ")}` : "Fits the platform and passes brand-safety checks." };
    }

    const platform = item.channel ? PLATFORM_BY_CHANNEL[item.channel] : undefined;
    const limit = platform ? PLATFORM_LIMITS[platform].maxText : undefined;
    const { runStructuredPrompt } = await import("@/lib/ai/run.server");
    const revision = await runStructuredPrompt({
      route: "agent.content-fit",
      system: [
        "You revise a marketing post so it passes the listed checks while keeping its message, voice and call to action.",
        limit ? `The whole post including hashtags must be at most ${limit} characters.` : "",
        "Remove personal data, unsubstantiated superlatives, guarantees, medical or financial promises and profanity.",
        'Return JSON {"title"?: string, "body": string, "hashtags"?: string[]}. Hashtags go in the array, not the body.',
      ]
        .filter(Boolean)
        .join("\n"),
      user: JSON.stringify({
        channel: item.channel,
        title: item.title,
        body: item.body,
        hashtags: item.hashtags,
        issues: fixable.map((i) => i.message),
      }),
      schema: RevisionSchema,
      maxTokens: 1500,
      temperature: 0.4,
    });

    // Re-check the proposal deterministically before offering it.
    const remaining = contentFitIssues({ ...item, ...revision, hashtags: revision.hashtags ?? item.hashtags });
    const proposed = await ctx.tool("content.apply_revision", {
      contentItemId: item.id,
      title: revision.title,
      body: revision.body,
      hashtags: revision.hashtags,
      reasons: fixable.map((i) => i.message).slice(0, 10),
    });
    await ctx.note("Proposed revision", {
      issues: fixable.length,
      remainingAfterRevision: remaining.filter((i) => i.severity === "block").length,
    });
    return {
      summary: `${fixable.length} issue${fixable.length === 1 ? "" : "s"} found; a revision is waiting for approval.`,
      awaitingApproval: proposed.status === "pending_approval",
    };
  },
};
