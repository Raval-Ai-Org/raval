import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHANGE_TYPES,
  CHECKPOINT_ALPHA,
  CHECKPOINT_DAYS,
  MAX_DURATION_DAYS,
  METRICS,
  MIN_DURATION_DAYS,
  Z_CHECKPOINT,
} from "./constants";
import {
  EXPERIMENT_STATUSES,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  countsTowardLimit,
  holdsPages,
  isTerminal,
  type ExperimentStatus,
} from "./state";

// Written out independently of state.ts so a change to either is caught.
const EXPECTED: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["draft", "shipping", "cancelled"],
  shipping: ["awaiting_deploy", "awaiting_approval", "cancelled"],
  awaiting_deploy: ["running", "cancelled", "invalidated"],
  running: ["analyzing", "invalidated", "cancelled"],
  analyzing: ["running", "concluded", "invalidated"],
  concluded: ["rolling_out", "rolling_back", "closed"],
  rolling_out: ["closed", "concluded"],
  rolling_back: ["closed", "concluded", "invalidated"],
  invalidated: ["rolling_back", "closed"],
  closed: [],
  cancelled: [],
};

const pairs = EXPERIMENT_STATUSES.flatMap((from) =>
  EXPERIMENT_STATUSES.map((to) => [from, to, EXPECTED[from].includes(to)] as const),
);

describe("experiment status transitions", () => {
  it.each(pairs)("%s → %s allowed: %s", (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
    if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
    else expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("never allows a self-transition", () => {
    for (const s of EXPERIMENT_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it("only closed and cancelled are terminal", () => {
    expect(EXPERIMENT_STATUSES.filter(isTerminal)).toEqual(["closed", "cancelled"]);
  });

  it("every non-terminal status can eventually reach closed or cancelled", () => {
    for (const start of EXPERIMENT_STATUSES) {
      const seen = new Set<ExperimentStatus>([start]);
      const queue: ExperimentStatus[] = [start];
      while (queue.length) {
        const s = queue.shift()!;
        for (const next of EXPECTED[s]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(seen.has("closed") || seen.has("cancelled")).toBe(true);
    }
  });

  it("a verdict can only be reached through analysis", () => {
    const into = EXPERIMENT_STATUSES.filter((s) => canTransition(s, "concluded"));
    expect(into.sort()).toEqual(["analyzing", "rolling_back", "rolling_out"]);
  });

  it("counts toward the plan limit from awaiting approval through concluded", () => {
    expect(EXPERIMENT_STATUSES.filter(countsTowardLimit)).toEqual([
      "awaiting_approval",
      "shipping",
      "awaiting_deploy",
      "running",
      "analyzing",
      "concluded",
    ]);
  });

  it("keeps pages reserved until closed or cancelled (invalidated keeps them)", () => {
    expect(holdsPages("invalidated")).toBe(true);
    expect(holdsPages("closed")).toBe(false);
    expect(holdsPages("cancelled")).toBe(false);
  });
});

describe("constants agree with the database and the statistics", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../../supabase/migrations/20260928090000_add_proof_engine.sql"),
    "utf8",
  );
  const checkValues = (constraint: string) => {
    const m = sql.match(new RegExp(`${constraint} CHECK \\(([\\s\\S]*?)\\)\\)`, "m"));
    if (!m) throw new Error(`constraint ${constraint} not found`);
    return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
  };

  it("status values match experiments_status_check", () => {
    expect(checkValues("experiments_status_check")).toEqual([...EXPERIMENT_STATUSES]);
  });

  it("change types match experiments_change_type_check", () => {
    expect(checkValues("experiments_change_type_check")).toEqual([...CHANGE_TYPES]);
  });

  it("metrics match experiments_primary_metric_check", () => {
    expect(checkValues("experiments_primary_metric_check")).toEqual([...METRICS]);
  });

  it("checkpoints span the minimum to the maximum duration", () => {
    expect(CHECKPOINT_DAYS[0]).toBe(MIN_DURATION_DAYS);
    expect(CHECKPOINT_DAYS[CHECKPOINT_DAYS.length - 1]).toBe(MAX_DURATION_DAYS);
  });

  it("Z_CHECKPOINT is the two-sided z for CHECKPOINT_ALPHA", () => {
    // Φ(2.36) ≈ 0.99086 → two-sided α ≈ 0.0183.
    const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
    expect(2 * (1 - phi(Z_CHECKPOINT))).toBeCloseTo(CHECKPOINT_ALPHA, 3);
  });
});

// Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
function erf(x: number): number {
  const sign = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}
