// service.server.ts — reading, writing and confirming a workspace's marketing
// strategy. Callers (src/server/fns/strategy.ts) have already checked the
// workspace role; writes here use the service role for that one workspace.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  StrategySchema,
  type MarketingStrategy,
  type StrategyStatus,
  type StrategyView,
} from "@/lib/strategy/contracts";
import { sanitizeEdit, toAutopilotStrategy } from "@/lib/strategy/ground";
import { HttpError } from "@/server/http-error";
import type { WorkspaceRole } from "@/server/api-auth";
import { invalidateStrategyContext } from "./context.server";
import { gatherStrategySources, type BrainKey } from "./sources.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "workspace_marketing_strategy";
const COLUMNS =
  "workspace_id, strategy, status, version, built_from, source_fingerprint, generations, generated_at, confirmed_at, updated_at";

export type StrategyCaller = { workspaceId: string; userId: string; role: WorkspaceRole };

type Row = {
  workspace_id: string;
  strategy: unknown;
  status: StrategyStatus;
  version: number;
  built_from: Partial<Record<BrainKey, boolean>> | null;
  source_fingerprint: string | null;
  generations: number;
  generated_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

const canEdit = (role: WorkspaceRole) => role !== "viewer";

async function readRow(workspaceId: string): Promise<Row | null> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the strategy: ${error.message}`);
  return (data as Row | null) ?? null;
}

function parse(raw: unknown): MarketingStrategy | null {
  const parsed = StrategySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The confirmed strategy, or null. What generators read (context.server.ts). */
export async function readConfirmedStrategy(
  workspaceId: string,
): Promise<MarketingStrategy | null> {
  const row = await readRow(workspaceId);
  return row?.status === "confirmed" ? parse(row.strategy) : null;
}

const NONE = { brand: false, audience: false, competitors: false, market: false };

export async function getStrategyView(caller: StrategyCaller): Promise<StrategyView> {
  const [row, sources] = await Promise.all([
    readRow(caller.workspaceId),
    gatherStrategySources(caller.workspaceId),
  ]);
  const strategy = row ? parse(row.strategy) : null;
  return {
    strategy,
    status: strategy ? row!.status : null,
    version: row?.version ?? 0,
    generatedAt: row?.generated_at ?? null,
    confirmedAt: row?.confirmed_at ?? null,
    updatedAt: row?.updated_at ?? null,
    stale:
      !!strategy && !!row?.source_fingerprint && row.source_fingerprint !== sources.fingerprint,
    builtFrom: { ...NONE, ...(row?.built_from ?? {}) },
    available: sources.available,
    canEdit: canEdit(caller.role),
    nextIsFree: (row?.generations ?? 0) === 0,
  };
}

/** Whether Mellox has ever written a strategy here (the first one is included). */
export async function hasGenerated(workspaceId: string): Promise<boolean> {
  return ((await readRow(workspaceId))?.generations ?? 0) > 0;
}

/**
 * Write a strategy for the workspace as a draft. `run` is the paid part, so the
 * caller decides whether it is metered. Returns false when the model's answer
 * wasn't usable — the previous strategy is left exactly as it was.
 */
export async function buildStrategy(
  caller: StrategyCaller,
  note: string | undefined,
): Promise<boolean> {
  const sources = await gatherStrategySources(caller.workspaceId);
  if (!sources.available.brand) {
    throw new HttpError(409, "Add your Brand DNA first, so the strategy is about your brand.");
  }
  const { generateStrategy } = await import("./generate.server");
  const strategy = await generateStrategy({
    workspaceId: caller.workspaceId,
    userId: caller.userId,
    sources,
    note,
  });
  if (!strategy) return false;

  const existing = await readRow(caller.workspaceId);
  const now = new Date().toISOString();
  const { error } = await db.from(TABLE).upsert(
    {
      workspace_id: caller.workspaceId,
      strategy,
      // A rebuild is a new proposal: it waits for a person again.
      status: "draft",
      version: (existing?.version ?? 0) + 1,
      built_from: sources.available,
      source_fingerprint: sources.fingerprint,
      generations: (existing?.generations ?? 0) + 1,
      generated_at: now,
      confirmed_at: null,
      confirmed_by: null,
      updated_by: caller.userId,
      updated_at: now,
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(`Could not save the strategy: ${error.message}`);
  invalidateStrategyContext(caller.workspaceId);
  return true;
}

/** Save a person's edits. `confirm` also makes it the strategy Mellox follows. */
export async function saveStrategy(
  caller: StrategyCaller,
  input: { strategy: unknown; version: number; confirm: boolean },
): Promise<void> {
  const [existing, sources] = await Promise.all([
    readRow(caller.workspaceId),
    gatherStrategySources(caller.workspaceId),
  ]);
  if (!existing) throw new HttpError(404, "There is no strategy to save yet.");
  if (existing.version !== input.version) {
    throw new HttpError(409, "This strategy changed somewhere else. Reload and try again.");
  }
  const strategy = sanitizeEdit(input.strategy, sources.facts);
  if (!strategy) {
    throw new HttpError(400, "A strategy needs a positioning line, a goal and two themes.");
  }
  const status: StrategyStatus = input.confirm ? "confirmed" : existing.status;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from(TABLE)
    .update({
      strategy,
      status,
      version: existing.version + 1,
      ...(input.confirm ? { confirmed_at: now, confirmed_by: caller.userId } : {}),
      updated_by: caller.userId,
      updated_at: now,
    })
    .eq("workspace_id", caller.workspaceId)
    .eq("version", existing.version)
    .select("workspace_id");
  if (error) throw new Error(`Could not save the strategy: ${error.message}`);
  if (!data?.length) {
    throw new HttpError(409, "This strategy changed somewhere else. Reload and try again.");
  }
  invalidateStrategyContext(caller.workspaceId);
  if (status === "confirmed") await followInAutopilot(caller.workspaceId, strategy);
}

/** A running Autopilot program plans its next weeks against the confirmed strategy. */
async function followInAutopilot(workspaceId: string, strategy: MarketingStrategy): Promise<void> {
  try {
    const { syncProgramStrategy } = await import("@/server/autopilot/service.server");
    await syncProgramStrategy(workspaceId, toAutopilotStrategy(strategy));
  } catch (error) {
    // The strategy is saved; Autopilot picks it up from the workspace next week.
    console.error("[strategy] could not update Autopilot's copy", error);
  }
}
