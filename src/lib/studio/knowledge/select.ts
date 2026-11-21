// knowledgeFor: the few lines of marketing knowledge one piece needs.
//
// Code picks, the model reasons: from what the piece is (kind, goal, format,
// ad objective, funnel stage) and who the brand is (its industry), it returns
// one awareness line, at most one framework, at most three skills and the
// industry's buyer lines, short enough to stay cheap and the same for the
// same inputs (so prompt caches keep working). Pure and browser-safe.
import { AWARENESS, SALES_CLARITY, awarenessFor, pickFramework } from "./frameworks";
import { industryBuyerLines, industryOf, type Industry } from "./industries";
import { skillsFor } from "./skills";

export type KnowledgeJob = {
  category?: string | null;
  goal?: string | null;
  format?: string | null;
  adObjective?: string | null;
  stage?: string | null;
  industry?: string | null;
  brandText?: string | null;
};

const SELLING = new Set(["sale", "product", "launch"]);
/** Kinds made like a person's post: they get the audience's world, never selling skills. */
const NATIVE = new Set(["meme", "relatable", "trend", "aesthetic", "quote", "ugc", "this-or-that"]);

export type Knowledge = {
  industry: Industry | null;
  lines: string[];
};

/** At most ~1,800 characters (about 450 tokens). */
export const KNOWLEDGE_MAX_CHARS = 1800;

export function knowledgeFor(job: KnowledgeJob): Knowledge {
  const industry = industryOf(job.industry, job.brandText);
  const framework = pickFramework(job);
  const awareness = AWARENESS[awarenessFor(job)];
  const native = !!job.category && NATIVE.has(job.category);
  const skills = skillsFor({ ...job, industry: native ? null : (industry?.id ?? null) });
  const selling =
    (job.category && SELLING.has(job.category)) ||
    job.goal === "offer" ||
    job.format === "ad" ||
    job.stage === "convert";
  const lines = [
    framework &&
      `Argument shape: ${framework.name}, ${framework.steps} Use it as a skeleton, in natural words; never label the steps.`,
    framework && `Reader: ${awareness.label.toLowerCase()}. ${awareness.say}`,
    selling ? SALES_CLARITY : null,
    ...skills.map((s) => `${s.name}: ${s.lines.join(" ")} Check: ${s.check}`),
    ...(native
      ? industry
        ? [
            `What this audience lives with (${industry.label.toLowerCase()}): they want ${industry.wants}; they worry about ${industry.doubts}. That is where the joke or the recognition comes from.`,
          ]
        : []
      : industryBuyerLines(industry)),
  ].filter((l): l is string => typeof l === "string" && l.length > 0);
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > KNOWLEDGE_MAX_CHARS) continue;
    out.push(line);
    used += line.length;
  }
  return { industry, lines: out };
}

/** The knowledge as a prompt rule (one line per entry). */
export function knowledgeRule(job: KnowledgeJob): string {
  const { lines } = knowledgeFor(job);
  return lines.length
    ? `Marketing craft for this piece:\n${lines.map((l) => `- ${l}`).join("\n")}`
    : "";
}
