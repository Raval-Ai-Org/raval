// POST /api/public/hooks/competitor-watch — pg_cron (every 30 min).
//
// Two jobs share this hook because they are the same job from the user's point
// of view, "keep an eye on the competition":
//   * legacy URL watches: snapshot-diff a watched page and raise alerts;
//   * competitor intelligence: profile newly tracked competitors and sweep for
//     meaningful changes (src/server/competitors/service.server.ts);
//   * community threads: who is asking about the brand's problem, field or
//     competitors (src/server/community/service.server.ts).
// Sharing the existing, already-scheduled hook is deliberate — this feature
// adds no new cron job and nothing new to enable per environment.
//
// Auth + heartbeat come from defineCronRoute (x-cron-secret header).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "competitor-watch",
  expectedIntervalSeconds: 30 * 60,
  handler: async () => {
    const started = Date.now();
    const [{ runDueCompetitorScans }, { runDueCompetitorJobs }, { runDueCommunityJobs }] =
      await Promise.all([
        import("@/lib/competitor-watch.server"),
        import("@/server/competitors/service.server"),
        import("@/server/community/service.server"),
      ]);
    // Sequential, and well inside pg_net's 120s timeout: the watches are cheap
    // page fetches, the competitor jobs spend a search and a model call each.
    const watches = await runDueCompetitorScans({ max: 40 });
    const competitors = await runDueCompetitorJobs({ budgetMs: 60_000, max: 3 });
    // Community threads (Brain → Market → Communities): a daily refresh per
    // workspace that asked for one; a few searches and one economy call each.
    // Only with the time left inside pg_net's 120s.
    const community = await runDueCommunityJobs({
      budgetMs: Math.min(40_000, 105_000 - (Date.now() - started)),
      max: 2,
    });
    return { ...watches, competitors, community };
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
