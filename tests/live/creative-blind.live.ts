// Round 9 blind benchmark (ADR-0053). PAID: run only after the owner agreed
// to a USD quote. It makes every frozen blind case (evals/creative/blind-cases.ts)
// once per arm through the real director path (buildPostPlanPrompt →
// runStructuredPrompt → postImagePrompt → generateImage), on one pinned image
// model, then a vision judge compares each pair blind, both ways round.
//
//   IMAGE_PROVIDER=openrouter CREATIVE_BLIND_IMAGE_MODEL=<pinned id> //   CREATIVE_BLIND_LIVE=yes CREATIVE_BLIND_ARMS="off,relevance+type+sectors" \
//   CREATIVE_BLIND_MAX_USD=18 npx vitest run --config vitest.live.config.ts tests/live/creative-blind.live.ts
//
// Image-model arm (Round 9): end an arm with "@<model id>" to pin that arm's
// image model, e.g. CREATIVE_BLIND_ARMS="off@<recraft id>,off@<gpt image id>".
// When both arms have the same skills the director's plan is written once
// per case and reused, so the two pictures differ only by the model.
// Paid: quote the run in USD and get the owner's yes before running it.
//
// Output in .live-out/blind/<run>/: pictures named by hash, key.json (which
// arm is left, kept apart from the pictures), judge.json, and gallery.html
// is opened from scripts/creative-benchmark/ for the owner's blind vote.
// Score with: node scripts/creative-benchmark/score.mjs .live-out/blind/<run>
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CreativeSkills } from "@/lib/feature-flags";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env */
}

const RUN = process.env.CREATIVE_BLIND_LIVE === "yes";
const MAX_USD = Number(process.env.CREATIVE_BLIND_MAX_USD || "18");
const LIMIT = Number(process.env.CREATIVE_BLIND_LIMIT || "0");
const ARMS = (process.env.CREATIVE_BLIND_ARMS || "off,relevance+type+sectors")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean)
  .slice(0, 2);
const RUN_ID =
  process.env.CREATIVE_BLIND_RUN || new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const OUT = path.resolve(".live-out/blind", RUN_ID);
/** One image model for both arms, so only the prompts differ. */
const PINNED_MODEL = process.env.CREATIVE_BLIND_IMAGE_MODEL || "";

/** The skills part of an arm ("relevance+type@model" → "relevance+type"). */
export function armSkillsPart(arm: string): string {
  return arm.split("@")[0].trim() || "off";
}

/** The image model an arm pins ("off@model" → "model"), else the run's pinned model. */
export function armModel(arm: string, fallback: string = PINNED_MODEL): string {
  const at = arm.indexOf("@");
  return at >= 0 ? arm.slice(at + 1).trim() || fallback : fallback;
}

export function armSkills(arm: string): CreativeSkills {
  const part = armSkillsPart(arm);
  if (part === "off") return {};
  const out: CreativeSkills = {};
  for (const pack of part.split("+")) (out as Record<string, boolean>)[pack.trim()] = true;
  return out;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

let spent = 0;

const JUDGE_SYSTEM = `You judge two finished social posts made for the same brief and brand. You do not know how either was made.
Score each picture 1-10 on: relevance (clearly this business and this brief), words (the drawn words fit the brief and sell), clarity (the point lands in one second), type (the type suits this brand; note its category), craft (a top agency would post it), brand (its colours and world), accuracy (words spelled right, nothing invented).
Then say which is better overall: "A", "B" or "tie". A clever picture that is unclear or off-brief loses.
Return JSON only: {"a": {"relevance": n, "words": n, "clarity": n, "type": n, "typeCategory": string, "craft": n, "brand": n, "accuracy": n}, "b": {same}, "better": "A" | "B" | "tie", "why": string}`;

const describeLive = RUN ? describe : describe.skip;

describeLive("creative blind benchmark (paid)", () => {
  it(
    "makes every case in both arms and judges them blind",
    async () => {
      expect(ARMS.length).toBe(2);
      const { runStructuredPrompt } = await import("@/lib/ai");
      const { llmJson } = await import("@/lib/ai-gateway.server");
      const { generateImage } = await import("@/lib/openrouter-image.server");
      const prompts = await import("@/lib/studio/prompts");
      const { buildPostPlanPrompt } = await import("@/lib/studio/post-plan");
      const { readBrief } = await import("@/lib/studio/brief-read");
      const { postImagePrompt } = await import("@/server/studio/visual-prompts.server");
      const { skillLinesFor } = await import("@/server/studio/skill-lines.server");
      const { BLIND_CASES, CONTROL_IDS, blindBrand, BLIND_VERSION } =
        await import("../../evals/creative/blind-cases");
      mkdirSync(path.join(OUT, "img"), { recursive: true });

      const cases = LIMIT ? BLIND_CASES.slice(0, LIMIT) : BLIND_CASES;
      const key: Record<string, { left: string; right: string; control: boolean }> = {};
      const made: Record<
        string,
        Record<string, { file: string; headline: string; model: string }>
      > = {};
      const log: string[] = [];
      // One plan per case + skills + brand, shared by arms that differ only by model.
      const plans = new Map<
        string,
        Promise<{ built: { system: string; user: string }; plan: Record<string, unknown> }>
      >();

      async function make(caseId: string, arm: string, workspaceId: string) {
        const c = cases.find((x) => x.id === caseId)!;
        const brand = blindBrand(c.brand);
        const ctx = {
          ...prompts.emptyContext(brand.name),
          brandText: brand.dna,
          visualBrandText: brand.dna,
          industry: brand.industry,
          audience: brand.audience,
          website: brand.website,
          today: "2026-11-24",
        };
        const skills = armSkills(arm);
        const planKey = `${caseId}:${armSkillsPart(arm)}:${workspaceId}`;
        if (!plans.has(planKey)) plans.set(planKey, writePlan());
        const { built, plan } = await plans.get(planKey)!;
        async function writePlan() {
          const pick = skillLinesFor({ workspaceId, ctx: ctx as never, skills });
          const read = readBrief(c.brief);
          const built = buildPostPlanPrompt({
            ctx: ctx as never,
            intent: { brief: c.brief, goal: c.goal } as never,
            controls: { platforms: c.platforms } as never,
            angle: prompts.BRIEF_ANGLE,
            briefRead: read,
            skills,
            skillLines: pick.lines,
          });
          const plan = (await runStructuredPrompt({
            route: built.route,
            system: built.system,
            user: built.user,
            schema: built.schema,
            maxTokens: built.maxTokens,
          } as never)) as Record<string, unknown>;
          return { built, plan };
        }
        const headline = String(plan.onImageText ?? "");
        const prompt = postImagePrompt({
          brandName: brand.name,
          concept: String(plan.concept ?? ""),
          headline,
          lines: ((plan.onImageLines as string[]) ?? []).slice(0, 2),
          ratio: "4:5",
          logoCorner: null,
        });
        if (spent > MAX_USD) throw new Error(`spend cap reached ($${spent.toFixed(2)})`);
        const img = await generateImage({
          prompt,
          size: "1024x1280",
          quality: "medium",
          budgeted: true,
          maxAttempts: 1,
          meterRoute: "studio.image.render",
          // `model` forces one model with no fallback; run with IMAGE_PROVIDER=openrouter.
          ...(armModel(arm) ? { model: armModel(arm) } : {}),
          routing: { referenceAssets: [], hasReference: false },
        } as never);
        spent += img.costUsd ?? 0;
        const file = `${sha(`${RUN_ID}:${caseId}:${arm}:${workspaceId}`)}.png`;
        writeFileSync(path.join(OUT, "img", file), Buffer.from(img.b64, "base64"));
        writeFileSync(
          path.join(OUT, "img", `${file}.txt`),
          `${built.system}\n----\n${built.user}\n====\n${prompt}`,
        );
        log.push(`${caseId}\t${arm}\t${img.model}\t$${(img.costUsd ?? 0).toFixed(4)}\t${headline}`);
        return {
          file,
          headline,
          model: String(img.model ?? ""),
          b64: img.b64 as string,
          technique: plan.technique,
        };
      }

      const judged: unknown[] = [];
      for (const c of cases) {
        const control = CONTROL_IDS.includes(c.id);
        // The same brand id for both arms keeps the type voice the brand would really get.
        const ws = `blind-${c.brand}`;
        const armA = ARMS[0];
        const armB = control ? ARMS[0] : ARMS[1];
        const a = await make(c.id, armA, ws);
        const b = await make(c.id, armB, control ? `${ws}-ctl` : ws);
        made[c.id] = { [armA]: a, [`${armB}${control ? "#2" : ""}`]: b };
        const flip = parseInt(sha(`${RUN_ID}:${c.id}:side`).slice(0, 2), 16) % 2 === 1;
        const [left, right] = flip ? [b, a] : [a, b];
        key[c.id] = { left: flip ? armB : armA, right: flip ? armA : armB, control };
        const brand = blindBrand(c.brand);
        // Judged both ways round; a win counts only when both orders agree.
        const verdicts = [];
        for (const [x, y] of [
          [left, right],
          [right, left],
        ]) {
          const v = await llmJson<Record<string, unknown>>({
            route: "bench.creative.judge",
            fallback: {},
            system: JUDGE_SYSTEM,
            user: `Brand: ${brand.name}, ${brand.industry}.\nBrief: ${c.brief}\nPicture A is the first image, picture B the second.`,
            images: [
              { mediaType: "image/png", data: x.b64 },
              { mediaType: "image/png", data: y.b64 },
            ],
          } as never);
          verdicts.push(v);
        }
        judged.push({ id: c.id, leftFile: left.file, rightFile: right.file, verdicts });
        writeFileSync(path.join(OUT, "judge.json"), JSON.stringify(judged, null, 2));
        writeFileSync(
          path.join(OUT, "key.json"),
          JSON.stringify({ version: BLIND_VERSION, arms: ARMS, key }, null, 2),
        );
        writeFileSync(path.join(OUT, "log.tsv"), log.join("\n"));
      }
      writeFileSync(
        path.join(OUT, "pairs.json"),
        JSON.stringify(
          Object.entries(key).map(([id, k]) => ({
            id,
            brief: cases.find((c) => c.id === id)?.brief,
            left: (judged.find((j) => (j as { id: string }).id === id) as { leftFile: string })
              ?.leftFile,
            right: (judged.find((j) => (j as { id: string }).id === id) as { rightFile: string })
              ?.rightFile,
          })),
          null,
          2,
        ),
      );
      console.log(`blind run ${RUN_ID}: ${cases.length} cases, $${spent.toFixed(2)} spent`);
    },
    6 * 60 * 60 * 1000,
  );
});
