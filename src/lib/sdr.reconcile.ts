// sdr.reconcile.ts — reconciliation backstop (FR-018): finds content_publications
// stuck in publishing/pending/retrying older than a threshold and reconciles them
// against the SDR job state, so nothing strands in "publishing" if a webhook is
// lost. Triggered by a pg_cron → guarded endpoint (see routes). Pure + injected.
import { callSdr } from "@/lib/sdr.server";

export type ReconcileDeps = {
  db: any;
  sdrBaseUrl: string;
  getToken: (workspaceId: string) => Promise<string>;
  staleMs?: number;
  limit?: number;
  callSdrFn?: typeof callSdr;
};

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
  for (const row of stale ?? []) {
    try {
      const token = await deps.getToken(row.workspace_id);
      const res = await (deps.callSdrFn ?? callSdr)({
        baseUrl: deps.sdrBaseUrl,
        token,
        method: "GET",
        path: `/api/v1/jobs/${encodeURIComponent(row.sdr_post_id)}`,
      });
      const target = res.data?.targets?.find((t: any) => t.target_id === row.sdr_target_id);
      const status: string | undefined = target?.status;
      if (status && ["published", "failed", "retrying"].includes(status)) {
        const patch: any = { status, updated_at: new Date().toISOString() };
        if (status === "published") {
          patch.platform_post_id = target.platform_post_id ?? null;
          patch.platform_post_url = target.platform_post_url ?? null;
        }
        await deps.db.from("content_publications").update(patch).eq("id", row.id);
        reconciled.push({ id: row.id, status });
      }
    } catch {
      // SDR unreachable — leave this row for the next sweep.
    }
  }

  return { swept: (stale ?? []).length, reconciled };
}
