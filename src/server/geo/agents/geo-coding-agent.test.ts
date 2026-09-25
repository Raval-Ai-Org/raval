import { describe, expect, it, vi } from "vitest";
import type { LlmToolLoopOpts, LlmToolLoopResult } from "@/lib/ai-gateway.tool-loop.server";
import type { AgentPlan } from "@/lib/geo/agent-contracts";
import type { SiteArtifacts } from "@/lib/geo/types";
import { strategyForRule } from "../fixes/strategies";
import { playbookFor } from "./framework-playbooks";
import {
  checkPlan,
  hashPlan,
  implementPlan,
  investigateAndPlan,
  resolveImport,
  type AgentContext,
  type AgentDeps,
} from "./geo-coding-agent";
import { newToolState, type RepoSnapshot } from "./repo-tools.server";

const sha = (n: number) => n.toString(16).padStart(40, "0");
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Three Reach Ai</title>
  </head>
  <body><div id="root"></div></body>
</html>
`;
const FILES: Record<string, string> = {
  "index.html": INDEX,
  "src/App.tsx": "export default function App(){ return <main>Three Reach Ai</main> }\n",
  "src/lib/seo.ts": "export const x = 1;\n",
  "package.json": JSON.stringify({ dependencies: { react: "18", vite: "5" } }),
};
const entries = Object.entries(FILES).map(([path, text], i) => ({
  path,
  sha: sha(i + 1),
  size: text.length,
}));
const blobs = new Map(entries.map((e) => [e.sha, FILES[e.path]]));

const snapshot: RepoSnapshot = {
  repo: "acme/threereach",
  branch: "main",
  sha: sha(999),
  entries,
  truncated: false,
  framework: "Vite",
  frameworkEvidence: "package.json depends on vite",
};

const site = {
  origin: "https://threereach.lovable.app",
  host: "threereach.lovable.app",
  robots: { status: "found", text: "", sitemaps: [] },
  llms: { found: false, bytes: 0, full: false },
  sitemap: { found: false, urls: 0, isIndex: false, sources: [] },
} as unknown as SiteArtifacts;

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    userId: "u-1",
    finding: {
      ruleId: "tech.meta_description",
      title: "Meta description",
      detail: "The page has no meta description.",
      evidence: {},
      pageUrl: "https://threereach.lovable.app/",
      severity: "medium",
      category: "technical",
      recommendation: "Add a meta description",
    },
    siteOrigin: site.origin,
    site,
    snapshot,
    playbook: playbookFor("Vite", ["index.html"]),
    strategy: strategyForRule("tech.meta_description"),
    fixKind: "meta-desc",
    recipe: null,
    targetHints: ["index.html"],
    dependencies: ["react", "vite"],
    allowedImports: new Set(),
    siteText: [
      "Three Reach Ai - Get Your Business Recommended by ChatGPT, Claude, Gemini, Grok, DeepSeek and Google Overviews",
    ],
    inputs: {},
    feedback: null,
    previousPlan: null,
    ...over,
  };
}

const PLAN: AgentPlan = {
  feasible: true,
  notFixableReason: null,
  manualSteps: ["Add a meta description to index.html"],
  strategy: "index.html head tags",
  scope: "site",
  summary: "Add a meta description to the document head served for every route.",
  files: [
    {
      path: "index.html",
      action: "update",
      reason: "The SPA's only HTML document",
      evidence: [{ path: "index.html", line: 5, note: "title here" }],
    },
  ],
  risks: [],
  outOfScope: [],
  validationCriteria: ["View source shows one meta description"],
  needsInput: [],
  verification: { scope: "page", urls: ["https://threereach.lovable.app/"] },
  confidence: "high",
};

type Call = { tool: string; input: unknown };

/** A fake tool loop: runs scripted tool calls through the real handler, one "turn" each. */
function scriptedLoop(script: Call[][]) {
  const outcomes: { tool: string; isError: boolean; content: string }[] = [];
  const loop = vi.fn(async (opts: LlmToolLoopOpts): Promise<LlmToolLoopResult> => {
    const turns = script.shift() ?? [];
    const usage = {
      turns: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    };
    for (const call of turns) {
      const out = await opts.handleTool(call.tool, call.input);
      outcomes.push({ tool: call.tool, isError: Boolean(out.isError), content: out.content });
      if (opts.terminalTools.includes(call.tool) && !out.isError) {
        return {
          status: "submitted",
          submission: { tool: call.tool, input: call.input },
          messages: opts.messages,
          usage,
          model: "anthropic/claude-opus-5.5",
        };
      }
    }
    return {
      status: "no_submission",
      submission: null,
      messages: opts.messages,
      usage,
      model: "anthropic/claude-opus-5.5",
    };
  });
  return { loop, outcomes };
}

function deps(over: Partial<AgentDeps> = {}): AgentDeps & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    toolDeps: {
      readBlob: async (s) => blobs.get(s) ?? null,
      fetchLive: async () => ({ status: 200, html: INDEX }),
      pageFacts: async () => [],
      ruleInfo: () => "rule",
    },
    onEvent: async (e) => {
      events.push(`${e.stage}:${e.summary}`);
    },
    isCancelled: async () => false,
    ...over,
  };
}

const approve = vi.fn(async () => ({
  text: JSON.stringify({ verdict: "approve", summary: "Looks right.", issues: [] }),
  truncated: false,
  model: "anthropic/claude-opus-5.5",
  degraded: false,
  costUsd: 0,
}));

describe("plan checks", () => {
  const exists = (p: string) => p in FILES;
  it("requires reading a file before planning to change it", () => {
    const problems = checkPlan(PLAN, {
      exists,
      filesRead: new Set(),
      strategy: strategyForRule("tech.meta_description"),
    });
    expect(problems.join(" ")).toMatch(/Read index.html/);
    expect(
      checkPlan(PLAN, {
        exists,
        filesRead: new Set(["index.html"]),
        strategy: strategyForRule("tech.meta_description"),
      }),
    ).toEqual([]);
  });

  it("refuses config paths, too many files and manual-only rules", () => {
    const bad = { ...PLAN, files: [{ ...PLAN.files[0], path: "vite.config.ts" }] };
    expect(
      checkPlan(bad, {
        exists: () => true,
        filesRead: new Set(["vite.config.ts"]),
        strategy: strategyForRule("tech.title"),
      }).join(" "),
    ).toMatch(/configuration/);
    const many = {
      ...PLAN,
      files: Array.from({ length: 5 }, (_, i) => ({
        ...PLAN.files[0],
        path: `p${i}.html`,
        action: "create" as const,
      })),
    };
    expect(
      checkPlan(many, {
        exists: () => false,
        filesRead: new Set(),
        strategy: strategyForRule("tech.title"),
      }).join(" "),
    ).toMatch(/at most 4/);
    expect(
      checkPlan(PLAN, {
        exists,
        filesRead: new Set(["index.html"]),
        strategy: strategyForRule("trust.terms"),
      }).join(" "),
    ).toMatch(/manually/);
  });

  it("binds approval to the plan and the inputs", () => {
    expect(hashPlan(PLAN, {})).toBe(hashPlan(JSON.parse(JSON.stringify(PLAN)), {}));
    expect(hashPlan(PLAN, {})).not.toBe(hashPlan(PLAN, { author: "x" }));
    expect(hashPlan(PLAN, {})).not.toBe(hashPlan({ ...PLAN, summary: "other" }, {}));
  });

  it("resolves project imports against the repository", () => {
    expect(resolveImport(snapshot, "./lib/seo", "src/App.tsx")).toBe(true);
    expect(resolveImport(snapshot, "@/lib/seo", "src/App.tsx")).toBe(true);
    expect(resolveImport(snapshot, "./lib/missing", "src/App.tsx")).toBe(false);
  });
});

describe("investigate → plan", () => {
  it("bounces a plan for an unread file, then accepts it after reading", async () => {
    const { loop, outcomes } = scriptedLoop([
      [
        { tool: "submit_plan", input: PLAN },
        {
          tool: "read_file",
          input: {
            path: "index.html",
            start_line: 1,
            end_line: 20,
            reason: "The served document head",
          },
        },
        { tool: "submit_plan", input: PLAN },
      ],
    ]);
    const d = deps({ loop });
    const state = newToolState();
    const r = await investigateAndPlan(ctx(), d, { state, budgetUsd: 1 });
    expect(outcomes[0]).toMatchObject({ tool: "submit_plan", isError: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.files[0].path).toBe("index.html");
      expect(r.filesInspected[0]).toMatchObject({
        path: "index.html",
        reason: "The served document head",
      });
    }
    expect(d.events.some((e) => e.includes("Plan needed changes"))).toBe(true);
  });

  it("adds required fact inputs the strategy needs", async () => {
    const plan = { ...PLAN, files: [{ ...PLAN.files[0] }] };
    const { loop } = scriptedLoop([
      [
        {
          tool: "read_file",
          input: { path: "index.html", start_line: 1, end_line: 20, reason: "head" },
        },
        { tool: "submit_plan", input: plan },
      ],
    ]);
    const r = await investigateAndPlan(
      ctx({
        strategy: strategyForRule("trust.dates"),
        finding: { ...ctx().finding, ruleId: "trust.dates" },
      }),
      deps({ loop }),
      { state: newToolState(), budgetUsd: 1 },
    );
    expect(r.ok && r.plan.needsInput.map((n) => n.key)).toContain("date_published");
  });

  it("reports a loop that ends without a submission", async () => {
    const { loop } = scriptedLoop([[{ tool: "list_files", input: { pattern: "**", limit: 10 } }]]);
    const r = await investigateAndPlan(ctx(), deps({ loop }), {
      state: newToolState(),
      budgetUsd: 1,
    });
    expect(r).toMatchObject({ ok: false, code: "no_submission" });
  });
});

describe("implement → review → validate → correct", () => {
  const goodEdit = {
    explanation: "Add a meta description from the site's tagline.",
    edits: [
      {
        path: "index.html",
        find: "    <title>Three Reach Ai</title>",
        replace:
          '    <title>Three Reach Ai</title>\n    <meta name="description" content="Get your business recommended by ChatGPT, Claude, Gemini and Google Overviews." />',
        why: "Adds the missing description",
      },
    ],
  };

  it("produces a validated patch", async () => {
    const { loop } = scriptedLoop([[{ tool: "submit_patch", input: goodEdit }]]);
    const r = await implementPlan(ctx(), PLAN, deps({ loop, complete: approve }), {
      state: newToolState(),
      budgetUsd: 1,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.files[0].diff).toContain('+    <meta name="description"');
      expect(r.validation.checks.find((c) => c.id === "grounding")?.status).toBe("pass");
      expect(r.validation.checks.find((c) => c.id === "rule")?.status).toBe("pass");
      expect(r.corrections).toBe(0);
    }
  });

  it("rejects edits outside the plan and non-unique finds inside the loop", async () => {
    const { loop, outcomes } = scriptedLoop([
      [
        {
          tool: "submit_patch",
          input: {
            explanation: "x",
            edits: [{ path: "src/App.tsx", find: "App", replace: "X", why: "" }],
          },
        },
        {
          tool: "submit_patch",
          input: {
            explanation: "x",
            edits: [{ path: "index.html", find: "    <", replace: "<", why: "" }],
          },
        },
        { tool: "submit_patch", input: goodEdit },
      ],
    ]);
    const r = await implementPlan(ctx(), PLAN, deps({ loop, complete: approve }), {
      state: newToolState(),
      budgetUsd: 1,
    });
    expect(outcomes[0]).toMatchObject({ isError: true });
    expect(outcomes[0].content).toMatch(/Only the approved plan's files/);
    expect(outcomes[1]).toMatchObject({ isError: true });
    expect(outcomes[1].content).toMatch(/matched \d+ places/);
    expect(r.ok).toBe(true);
  });

  it("corrects a fabricated claim, then fails after two rounds", async () => {
    const fabricated = {
      explanation: "x",
      edits: [
        {
          path: "index.html",
          find: "    <title>Three Reach Ai</title>",
          replace:
            '    <title>Three Reach Ai</title>\n    <meta name="description" content="Trusted by 12,000 agencies since 2015 worldwide." />',
          why: "",
        },
      ],
    };
    const { loop } = scriptedLoop([
      [{ tool: "submit_patch", input: fabricated }],
      [{ tool: "submit_patch", input: fabricated }],
      [{ tool: "submit_patch", input: fabricated }],
    ]);
    const d = deps({ loop, complete: approve });
    const r = await implementPlan(ctx(), PLAN, d, { state: newToolState(), budgetUsd: 1 });
    expect(r).toMatchObject({ ok: false, code: "validation_failed" });
    expect(loop).toHaveBeenCalledTimes(3);
    expect(d.events.filter((e) => e.startsWith("correct:"))).toHaveLength(2);
  });

  it("feeds review blockers back and accepts the corrected patch", async () => {
    const reviews = [
      {
        verdict: "revise",
        summary: "Duplicate tag",
        issues: [
          {
            severity: "blocker",
            category: "correctness",
            path: "index.html",
            detail: "x",
            suggestion: "y",
          },
        ],
      },
      { verdict: "approve", summary: "ok", issues: [] },
    ];
    const complete = vi.fn(async () => ({
      text: JSON.stringify(reviews.shift()),
      truncated: false,
      model: "m",
      degraded: false,
      costUsd: 0,
    }));
    const { loop } = scriptedLoop([
      [{ tool: "submit_patch", input: goodEdit }],
      [{ tool: "submit_patch", input: goodEdit }],
    ]);
    const r = await implementPlan(ctx(), PLAN, deps({ loop, complete }), {
      state: newToolState(),
      budgetUsd: 1,
    });
    expect(r).toMatchObject({ ok: true, corrections: 1 });
  });
});
