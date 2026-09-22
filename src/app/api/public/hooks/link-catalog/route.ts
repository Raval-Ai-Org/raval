// POST /api/public/hooks/link-catalog — pg_cron (daily) mirrors the provider's
// placement catalog into Postgres.
//
// The mirror is what lets Mellox rank thousands of sites in one query, and what
// makes a checkout quote trustworthy: an order is re-priced against rows a sync
// saw recently, so a price that moved is caught before credits are held.
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "link-catalog",
  expectedIntervalSeconds: 86_400,
  handler: async () => {
    const { syncCatalog } = await import("@/server/links/catalog.server");
    // A partial walk is safe: only a complete, error-free one is allowed to
    // mark anything as delisted.
    return syncCatalog({ deadline: Date.now() + 100_000 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
