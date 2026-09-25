import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEO_PROBE_MODELS,
  ECONOMY,
  effectivePlan,
  escalatedPlan,
  geoProbeModels,
  hasTaskPlan,
  NON_MODEL_ROUTES,
  planFor,
  PREMIUM,
  registeredRoutes,
  routeEnvKey,
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
      models: [PREMIUM, WORKHORSE],
      effort: "medium",
      maxTokens: 12_000,
    });
    expect(planFor("chat").models).toEqual([WORKHORSE, "openai/gpt-5.6-terra"]);
    expect(planFor("competitors.updates").models).toEqual([ECONOMY, "openai/gpt-5.6-luna"]);
    expect(planFor("ai-generate.caption").models[0]).toBe(WORKHORSE);
    expect(planFor("schedule.weekly").effort).toBe("medium");
  });

  it("throws on an unknown route outside production and falls back in production", () => {
    expect(() => planFor("nope.not-registered")).toThrow(/No model plan/);
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(planFor("nope.not-registered").models[0]).toBe(WORKHORSE);
    warn.mockRestore();
  });

  it("applies AI_MODEL_<ROUTE> and AI_EFFORT_<ROUTE> overrides", () => {
    expect(routeEnvKey("brand-kit/analyze-visual")).toBe("BRAND_KIT_ANALYZE_VISUAL");
    vi.stubEnv("AI_MODEL_BRAND_EXTRACT", " x/one , x/two ");
    vi.stubEnv("AI_EFFORT_BRAND_EXTRACT", "HIGH");
    expect(planFor("brand-extract")).toMatchObject({ models: ["x/one", "x/two"], effort: "high" });
    vi.stubEnv("AI_EFFORT_CHAT", "extreme");
    expect(planFor("chat").effort).toBe("low");
  });

  it("escalates only when the rule's condition holds", () => {
    expect(escalatedPlan("chat.pro", false).effort).toBe("low");
    expect(escalatedPlan("chat.pro", true)).toMatchObject({
      models: [PREMIUM, WORKHORSE],
      effort: "medium",
    });
    expect(escalatedPlan("coach.briefing", true).effort).toBe("high");
    expect(escalatedPlan("ai-generate.blog", true).models[0]).toBe(PREMIUM);
    expect(escalatedPlan("geo.cms.fix", true).models[0]).toBe(PREMIUM);
    expect(escalatedPlan("file-extract", true).models[0]).toBe(WORKHORSE);
    // A route without a rule is unchanged.
    expect(escalatedPlan("ugc.notes", true)).toEqual(planFor("ugc.notes"));
  });

  it("steps each tier down one past the spend ceiling", () => {
    expect(effectivePlan(planFor("brand-extract"), true).models[0]).toBe(WORKHORSE);
    expect(effectivePlan(planFor("chat"), true).models[0]).toBe(ECONOMY);
    expect(effectivePlan(planFor("competitors.updates"), true).models[0]).toBe(ECONOMY);
    expect(effectivePlan(planFor("geo.agent.investigate"), true).effort).toBe("medium");
    expect(effectivePlan(planFor("chat"), false)).toEqual(planFor("chat"));
    // Escalation never survives the ceiling.
    expect(effectivePlan(escalatedPlan("ai-generate", true), true).models[0]).toBe(WORKHORSE);
  });

  it("asks each answer engine separately by default", () => {
    expect(geoProbeModels()).toEqual([...DEFAULT_GEO_PROBE_MODELS]);
    vi.stubEnv("GEO_PROBE_MODELS", "perplexity/sonar,x-ai/grok-4");
    expect(geoProbeModels()).toEqual(["perplexity/sonar", "x-ai/grok-4"]);
  });
});
