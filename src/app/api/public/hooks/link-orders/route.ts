// POST /api/public/hooks/link-orders — pg_cron (every minute) drives the link
// marketplace: advances one order cycle, then polls the provider's link list,
// re-checks published placements and refunds anything that never appeared.
//
// Every minute rather than every two: a cycle holding the global provider lock
// must not sit idle, because nothing else can order while it does. Auth and the
// heartbeat come from defineCronRoute (x-cron-secret, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "link-orders",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { runDueOrders } = await import("@/server/links/service.server");
    // Stays inside pg_net's 120 s call timeout with room to spare.
    return runDueOrders({ budgetMs: 55_000 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
