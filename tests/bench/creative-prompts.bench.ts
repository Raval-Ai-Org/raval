// Free creative benchmark: every case in evals/creative/cases.ts goes through
// the real prompt builders and the captured prompts are written to disk. No
// model or image call is made (UGC's completer is a stub that records the
// prompt), so a run costs nothing.
//
//   BENCH_LABEL=baseline BENCH_OUT=H:/MelloxResearch/bench npx vitest run --config vitest.bench.config.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRANDS,
  CASES,
  brandOf,
  type BenchBrand,
  type BenchCase,
} from "../../evals/creative/cases";
import {
  ANGLES,
  buildAdPrompt,
  buildCaptionPrompt,
  buildCarouselPrompt,
  buildVideoStoryboardPrompt,
  buildVisualBriefPrompt,
  emptyContext,
  type StudioContext,
} from "@/lib/studio/prompts";
import { getAdObjective } from "@/lib/studio/ad-objectives";
import { pickAdFormat } from "@/lib/studio/ad-formats";
import { pickCarouselStructure } from "@/lib/studio/carousel/story";
import { clipPlan } from "@/lib/studio/video/lengths";
import { pickVideoHook } from "@/lib/studio/video/hooks";
import { videoKind } from "@/lib/studio/video/kinds";
import type { VideoKindId } from "@/lib/studio/video/kinds";

const LABEL = process.env.BENCH_LABEL || "run";
const OUT = join(process.env.BENCH_OUT || "bench-out", LABEL);

type Captured = { stage: string; system: string; user: string };

const tokens = (s: string) => Math.ceil(s.length / 4);

function ctxFor(brand: BenchBrand): StudioContext {
  return {
    ...emptyContext(brand.name),
    brandText: brand.dna,
    visualBrandText: brand.dna,
    industry: brand.industry,
    audience: brand.audience,
    website: brand.website,
    today: "2026-11-13",
  };
}

function args(c: BenchCase, i: number) {
  const brand = brandOf(c.brand);
  return {
    brand,
    base: {
      ctx: ctxFor(brand),
      intent: { brief: c.brief, goal: c.goal, category: c.category } as never,
      controls: { platforms: c.platforms, durationSec: 16 } as never,
      angle: ANGLES[i % ANGLES.length],
    },
  };
}

async function capture(c: BenchCase, i: number): Promise<Captured[]> {
  const { brand, base } = args(c, i);
  const out: Captured[] = [];
  const push = (stage: string, p: { system: string; user: string }) =>
    out.push({ stage, system: p.system, user: p.user });

  switch (c.kind) {
    case "image":
    case "meme":
    case "educational":
      push("visual-brief", buildVisualBriefPrompt({ ...base, medium: "image" }));
      push(
        "caption",
        buildCaptionPrompt({ ...base, visual: "(the concept the visual brief wrote)" }),
      );
      break;
    case "sales": {
      const objective = getAdObjective(c.adObjective);
      const adFormat = pickAdFormat({
        objective,
        hasProduct: false,
        seed: c.id,
        goal: c.goal as never,
      });
      push("ad", buildAdPrompt({ ...base, adObjective: objective, adFormat }));
      push("visual-brief", buildVisualBriefPrompt({ ...base, medium: "image" }));
      break;
    }
    case "carousel": {
      const carouselStructure = pickCarouselStructure({
        seed: c.id,
        brief: c.brief,
        category: c.category,
        angleId: base.angle.id,
      });
      push("carousel", buildCarouselPrompt({ ...base, carouselStructure }));
      break;
    }
    case "video": {
      const kindId = (c.videoKind ?? "product-showcase") as VideoKindId;
      const kind = videoKind(kindId);
      push(
        "storyboard",
        buildVideoStoryboardPrompt({
          ...base,
          video: {
            kind: kindId,
            plan: clipPlan(16, "standard" as never),
            fromPicture: false,
            voice: true,
            hook: pickVideoHook(kindId, kind.people, [], c.id),
          },
        }),
      );
      break;
    }
    case "ugc": {
      const { generateConcepts } = await import("@/server/ugc/concepts.server");
      const { BriefSchema, ProductSchema } = await import("@/lib/ugc/schemas");
      const product = ProductSchema.parse({
        name: brand.products[0],
        brand: brand.name,
        description: `${brand.products[0]} by ${brand.name}.`,
        category: brand.industry,
      });
      const brief = BriefSchema.parse({ objective: "sales", durationSec: 15 });
      const dna = Object.fromEntries(brand.dna.split("\n").map((l) => l.split(": ")));
      await generateConcepts(
        {
          product,
          brief,
          brand: {
            brandName: brand.name,
            voice: dna.Voice,
            audience: brand.audience,
            positioning: dna.Positioning,
            industry: brand.industry,
            customer: {
              painPoints: dna["Customer pain points"],
              objections: dna["Customer objections"],
            },
          },
          workspace: { industry: brand.industry, audience: brand.audience },
          durationSec: 15,
          seed: `bench:${c.id}`,
        },
        (async (opts: {
          system?: string;
          user?: string;
          prompt?: string;
          messages?: { role: string; content: unknown }[];
        }) => {
          const sys =
            opts.system ?? String(opts.messages?.find((m) => m.role === "system")?.content ?? "");
          const user =
            opts.user ??
            opts.prompt ??
            String(
              opts.messages
                ?.filter((m) => m.role === "user")
                .map((m) => m.content)
                .join("\n") ?? "",
            );
          out.push({ stage: "ugc-concept", system: sys, user });
          throw new Error("bench: prompt captured");
        }) as never,
      ).catch(() => undefined);
      break;
    }
    case "campaign": {
      const { buildCampaignSkeleton } = await import("@/lib/campaigns/skeleton");
      const { PLAN_SYSTEM, planUserPrompt } = await import("@/lib/campaigns/prompt");
      const { PLAYBOOKS } = await import("@/lib/campaigns/playbooks");
      const { CampaignBriefSchema } = await import("@/lib/campaigns/contracts");
      const playbook = PLAYBOOKS.find((p) => p.id === c.playbook) ?? PLAYBOOKS[0];
      const brief = CampaignBriefSchema.parse({
        type: playbook.id,
        name: c.brief,
        startsOn: "2026-11-16",
        keyDate: "2026-12-04",
        channels: c.platforms,
        goal:
          c.goal === "leads"
            ? { kind: "leads", link: `${brand.website}/register` }
            : { kind: "sales", link: `${brand.website}/shop` },
      });
      const skeleton = buildCampaignSkeleton(playbook, brief, [], "2026-11-13");
      push("campaign-plan", {
        system: PLAN_SYSTEM,
        user: planUserPrompt({
          playbook,
          brief,
          pieces: skeleton.pieces,
          phases: skeleton.phases,
          brandText: brand.dna,
          productLines: brand.products,
          mediaLines: [],
        }),
      });
      break;
    }
  }
  return out;
}

describe("creative benchmark (free, prompt level)", () => {
  it("has 100 cases over every brand", () => {
    expect(CASES).toHaveLength(100);
    expect(new Set(CASES.map((c) => c.brand)).size).toBe(BRANDS.length);
  });

  it("captures every case", async () => {
    mkdirSync(OUT, { recursive: true });
    const summary: Record<string, unknown>[] = [];
    for (const [i, c] of CASES.entries()) {
      const prompts = await capture(c, i);
      expect(prompts.length, c.id).toBeGreaterThan(0);
      writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ case: c, prompts }, null, 2));
      summary.push({
        id: c.id,
        kind: c.kind,
        brand: c.brand,
        stages: prompts.map((p) => ({
          stage: p.stage,
          systemTokens: tokens(p.system),
          userTokens: tokens(p.user),
        })),
      });
    }
    const total = summary.reduce(
      (sum, s) =>
        sum +
        (s.stages as { systemTokens: number; userTokens: number }[]).reduce(
          (a, st) => a + st.systemTokens + st.userTokens,
          0,
        ),
      0,
    );
    writeFileSync(
      join(OUT, "summary.json"),
      JSON.stringify({ label: LABEL, totalTokens: total, cases: summary }, null, 2),
    );
  }, 120_000);
});
