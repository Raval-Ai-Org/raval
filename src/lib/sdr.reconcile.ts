// sdr.reconcile.ts — reconciliation backstop (FR-018): finds content_publications
// stuck in publishing/pending/retrying older than a threshold and reconciles them
// against the SDR job state, so nothing strands in "publishing" if a webhook is
// lost. Triggered by a pg_cron → guarded endpoint (see routes). Pure + injected.
//
// Each row is reconciled against ITS workspace's SDR (per-workspace base URL
// override), and applies the same effects as a verified webhook: delivered_at
// on publish, and a recomputed content item status.
import { callSdr } from "@/lib/sdr.server";
import { recomputeItemStatus } from "@/lib/sdr.webhook";

export type ReconcileDeps = {
  db: any;
  /** Fallback base URL when no per-workspace config resolver is supplied. */
  sdrBaseUrl: string;
  getToken?: (workspaceId: string) => Promise<string>;
  /** Preferred: resolves both the key and the workspace's SDR base URL. */
  getConfig?: (workspaceId: string) => Promise<{ token: string; baseUrl: string }>;
  staleMs?: number;
  limit?: number;
  callSdrFn?: typeof callSdr;
};

async function configFor(deps: ReconcileDeps, workspaceId: string) {
  if (deps.getConfig) return deps.getConfig(workspaceId);
  if (!deps.getToken) throw new Error("reconcile needs getConfig or getToken");
  return { token: await deps.getToken(workspaceId), baseUrl: deps.sdrBaseUrl };
}

export async function reconcileStalePublications(deps: ReconcileDeps) {
  const staleMs = deps.staleMs ?? 10 * 60 * 1000;
  const limit = deps.limit ?? 25;
  const cutoff = new Date(Date.now() - staleMs).toISOString();

  const { data: stale } = await deps.db
    .from("content_publications")
    .select("*")
    .in("status", ["publishing", "pending", "retrying"])
    .lt("updated_at", cutoff)
    .limit(limit);

  const reconciled: Array<{ id: string; status: string }> = [];
  const touchedItems = new Set<string>();
  let unreachable = 0;
  for (const row of stale ?? []) {
    try {
      const { token, baseUrl } = await configFor(deps, row.workspace_id);
      const res = await (deps.callSdrFn ?? callSdr)({
        baseUrl,
        token,
        method: "GET",
        path: `/api/v1/jobs/${encodeURIComponent(row.sdr_post_id)}`,
      });
      const target = res.data?.targets?.find((t: any) => t.target_id === row.sdr_target_id);
      const status: string | undefined = target?.status;
      if (status && ["published", "failed", "retrying"].includes(status) && status !== row.status) {
        const now = new Date().toISOString();
        const patch: any = { status, updated_at: now };
        if (status === "published") {
          patch.platform_post_id = target.platform_post_id ?? null;
          patch.platform_post_url = target.platform_post_url ?? null;
          patch.delivered_at = now;
        }
        if (status === "failed" || status === "retrying") {
          patch.error_category = target.error_category ?? null;
          patch.last_error = target.last_error ?? null;
        }
        await deps.db.from("content_publications").update(patch).eq("id", row.id);
        reconciled.push({ id: row.id, status });
        if (row.content_item_id) touchedItems.add(row.content_item_id);
      }
    } catch {
      // SDR unreachable — leave this row for the next sweep.
      unreachable++;
    }
  }

  for (const itemId of touchedItems) {
    try {
      await recomputeItemStatus(deps.db, itemId);
    } catch (e) {
      console.error("[sdr:reconcile] item status recompute failed", itemId, e);
    }
  }

  return { swept: (stale ?? []).length, reconciled, unreachable };
}
