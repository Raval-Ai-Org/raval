import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEO_PROBE_MODELS,
  ANALYST,
  BUDGET,
  canTurnReasoningOff,
  CONVERSATION,
  ECONOMY,
  LUNA,
  WRITER,
  effectivePlan,
  escalatedPlan,
  geoProbeModels,
  hasTaskPlan,
  isOpenWeightModel,
  knownModels,
  LABELLER,
  NON_MODEL_ROUTES,
  planFor,
  PREMIUM,
  registeredRoutes,
  routeEnvKey,
  SUMMARY,
  WORKHORSE,
} from "./task-models";

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every `route:` label in src/: string literals, and the static prefix of template literals. */
function routeLabels(): { label: string; dynamic: boolean; file: string }[] {
  const out: { label: string; dynamic: boolean; file: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/\broute:\s*(["'`])([^"'`]*?)\1(\s*\|)?/g)) {
      if (m[3]) continue; // a type union such as `route: "flare" | "sunburst"`
      const raw = m[2];
      const dynamic = m[1] === "`" && raw.includes("${");
      out.push({ label: dynamic ? raw.slice(0, raw.indexOf("${")) : raw, dynamic, file });
    }
    // Both labels of `route: cond ? "a" : "b"`.
    for (const m of text.matchAll(
      /\broute:\s*[\w.!?() ]+?\?\s*(["'])([^"'`]+)\1\s*:\s*(["'])([^"'`]+)\3/g,
    )) {
      out.push({ label: m[2], dynamic: false, file }, { label: m[4], dynamic: false, file });
    }
  }
  return out;
}

function exempt(label: string, dynamic: boolean): boolean {
  if (dynamic && label === "") return true; // `${moduleName}/${fnName}` RPC scope labels
  return NON_MODEL_ROUTES.some((r) =>
    r.endsWith(".*") ? label.startsWith(r.slice(0, -1)) : r === label,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("task model registry", () => {
  it("has a plan for every route label used in src/", () => {
    const labels = routeLabels();
    expect(labels.length).toBeGreaterThan(50);
    const missing = labels
      .filter(({ label, dynamic }) => !exempt(label, dynamic))
      .filter(({ label, dynamic }) => !hasTaskPlan(dynamic ? `${label}x` : label))
      .map(({ label, file }) => `${label} (${path.relative(SRC, file)})`);
    expect(missing).toEqual([]);
  });

  it("gives every plan a model list, and every tiered plan a fallback", () => {
    for (const route of registeredRoutes()) {
      const plan = planFor(route);
      expect(plan.models.length, route).toBeGreaterThan(0);
      if (route !== "geo.probe") expect(plan.models.length, route).toBeGreaterThan(1);
    }
  });

  it("uses the table's tiers, efforts and fallbacks", () => {
    expect(planFor("brand-extract")).toMatchObject({
      models: [ANALYST, WORKHORSE],
      effort: "medium",
      maxTokens: 12_000,
    });
    // Rare, high-stakes work stays on the premium tier.
    expect(planFor("studio.article").models[0]).toBe(PREMIUM);
    expect(planFor("studio.video.storyboard").models[0]).toBe(PREMIUM);
    expect(planFor("geo.agent.implement").models[0]).toBe(PREMIUM);
    expect(planFor("studio.ideas")).toMatchObject({ models: [BUDGET, WRITER], effort: "none" });
    expect(planFor("chat").models).toEqual([WRITER, LUNA]);
    expect(planFor("competitors.updates").models).toEqual([LABELLER, LUNA]);
    expect(planFor("ai-generate.caption").models[0]).toBe(WRITER);
    expect(planFor("studio.upload-captions")).toMatchObject({
      models: [WRITER, LUNA],
      effort: "medium",
    });
    expect(planFor("schedule.weekly").effort).toBe("medium");
    // Pictures, frames and sound stay on the model that sees and hears them.
    for (const route of ["studio.transcribe", "studio.video.qa", "studio.image.review"]) {
      expect(planFor(route).models[0], route).toBe(WORKHORSE);
    }
  });

  it("keeps every fallback at or under its primary's price", () => {
    const price: Record<string, number> = {
      [PREMIUM]: 24,
      [ANALYST]: 12,
      [CONVERSATION]: 12,
      [WORKHORSE]: 4.95,
      [BUDGET]: 0.75,
      [WRITER]: 0.6,
      [LUNA]: 0.6,
      [LABELLER]: 0.118,
    };
    for (const route of registeredRoutes()) {
      const [primary, ...fallbacks] = planFor(route).models;
      if (!(primary in price)) continue;
      // GLM-5.3 Flash has nothing cheaper that labels as well; Luna is its spare.
      if (primary === LABELLER) continue;
      for (const model of fallbacks) {
        expect(price[model], `${route}: ${model}`).toBeLessThanOrEqual(price[primary]);
      }
    }
  });

  it("turns reasoning off only on models that accept it", () => {
    for (const route of registeredRoutes()) {
      const plan = planFor(route);
      if (plan.effort !== "none") continue;
      expect(plan.models.every(canTurnReasoningOff), route).toBe(true);
    }
    expect(canTurnReasoningOff(BUDGET)).toBe(true);
    expect(canTurnReasoningOff(WRITER)).toBe(true);
    expect(canTurnReasoningOff(WORKHORSE)).toBe(false);
    expect(canTurnReasoningOff(LABELLER)).toBe(false);
    expect(canTurnReasoningOff(PREMIUM)).toBe(false);
  });

  it("lets an admin override choose any tier model, and knows which are open-weight", () => {
    const known = knownModels();
    for (const model of [ANALYST, SUMMARY, BUDGET, LABELLER, "anthropic/claude-haiku-5.5"]) {
      expect(known.has(model), model).toBe(true);
    }
    expect(isOpenWeightModel(BUDGET)).toBe(true);
    expect(isOpenWeightModel(LABELLER)).toBe(true);
    expect(isOpenWeightModel(PREMIUM)).toBe(false);
    expect(isOpenWeightModel(WORKHORSE)).toBe(false);
  });

  it("throws on an unknown route outside production and falls back in production", () => {
    expect(() => planFor("nope.not-registered")).toThrow(/No model plan/);
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(planFor("nope.not-registered").models[0]).toBe(WORKHORSE);
    warn.mockRestore();
  });

  it("applies AI_MODEL_<ROUTE> and AI_EFFORT_<ROUTE> overrides", () => {
    expect(routeEnvKey("geo.agent.investigate")).toBe("GEO_AGENT_INVESTIGATE");
    vi.stubEnv("AI_MODEL_BRAND_EXTRACT", " x/one , x/two ");
    vi.stubEnv("AI_EFFORT_BRAND_EXTRACT", "HIGH");
    expect(planFor("brand-extract")).toMatchObject({ models: ["x/one", "x/two"], effort: "high" });
    vi.stubEnv("AI_EFFORT_CHAT", "extreme");
    expect(planFor("chat").effort).toBe("low");
  });

  it("escalates only when the rule's condition holds", () => {
    expect(escalatedPlan("chat.pro", false).effort).toBe("low");
    // Pro chat never moves to Opus by itself (Mellox Lean).
    expect(escalatedPlan("chat.pro", true)).toEqual(planFor("chat.pro"));
    expect(planFor("chat.pro").models[0]).toBe(CONVERSATION);
    expect(escalatedPlan("coach.briefing", true).effort).toBe("high");
    expect(escalatedPlan("ai-generate.blog", true).models[0]).toBe(PREMIUM);
    expect(escalatedPlan("geo.cms.fix", true).models[0]).toBe(PREMIUM);
    expect(escalatedPlan("file-extract", true).models[0]).toBe(WORKHORSE);
    // A route without a rule is unchanged.
    expect(escalatedPlan("ugc.notes", true)).toEqual(planFor("ugc.notes"));
  });

  it("steps each tier down one past the spend ceiling", () => {
    expect(effectivePlan(planFor("brand-extract"), true).models[0]).toBe(WRITER);
    // The writer is already the cheapest that writes well: only its effort drops.
    expect(effectivePlan(planFor("chat"), true).models).toEqual([WRITER, LUNA]);
    expect(effectivePlan(planFor("studio.script"), true).effort).toBe("medium");
    expect(effectivePlan(planFor("audience.score"), true).models[0]).toBe(ECONOMY);
    expect(effectivePlan(planFor("competitors.updates"), true).models[0]).toBe(LABELLER);
    expect(effectivePlan(planFor("studio.transcribe"), true).models[0]).toBe(WORKHORSE);
    expect(effectivePlan(planFor("studio.ideas"), true)).toMatchObject({
      models: [BUDGET, WRITER],
      effort: "none",
    });
    expect(effectivePlan(planFor("geo.agent.investigate"), true).effort).toBe("medium");
    expect(effectivePlan(planFor("chat"), false)).toEqual(planFor("chat"));
    // Escalation never survives the ceiling.
    expect(effectivePlan(escalatedPlan("ai-generate", true), true).models[0]).toBe(WRITER);
  });

  it("asks each answer engine separately by default", () => {
    expect(geoProbeModels()).toEqual([
      "perplexity/sonar",
      "openai/gpt-6-luna",
      "google/gemini-3.8-flash",
    ]);
    expect(geoProbeModels()).toEqual([...DEFAULT_GEO_PROBE_MODELS]);
    vi.stubEnv("GEO_PROBE_MODELS", "perplexity/sonar,x-ai/grok-4");
    expect(geoProbeModels()).toEqual(["perplexity/sonar", "x-ai/grok-4"]);
  });
});
