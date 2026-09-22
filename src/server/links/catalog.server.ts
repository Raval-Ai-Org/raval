// Mirrors the provider catalog into Postgres so ranking a shortlist is one SQL
// query instead of 450-odd paginated HTTP calls per user.
//
// The mirror is also what makes prices trustworthy at checkout: an order is
// re-quoted against `rixot_donors` rows that a sync saw recently, so a price
// that moved is caught before any money is held rather than after the provider
// has already written an article.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { listDonors, rixotConfigured, type RixotDonor } from "./rixot/client.server";

/**
 * Pages fetched at once. The catalog is ~480 pages of 20. At 4, with a write
 * per page, a full walk took nearly two minutes and ran out of tick budget —
 * which would have left the lowest-ranked quarter of the catalog perpetually
 * stale. At 12, with one write per batch, the whole walk takes about 25
 * seconds, and it is still a modest ask of the provider.
 */
const CONCURRENCY = 12;

/** A catalog row older than this is not trusted for a quote. */
export const FRESH_HOURS = 36;

export type SyncResult = {
  pagesFetched: number;
  totalPages: number;
  donorsSeen: number;
  delisted: number;
  complete: boolean;
  errors: string[];
};

function toRow(donor: RixotDonor): Json {
  return {
    id: donor.id,
    domain: donor.domain,
    ext: donor.ext,
    page: donor.page,
    domain_hidden: donor.domainHidden,
    price_usd: donor.priceUsd,
    dr: donor.dr,
    referring_domains: donor.referringDomains,
    backlinks: donor.backlinks,
    dfs_rank: donor.dfsRank,
    top100: donor.top100,
    cat: donor.cat,
  };
}

async function writePage(donors: RixotDonor[]): Promise<void> {
  if (donors.length === 0) return;

  // The provider's pagination really does return the same donor id on more
  // than one page, and Postgres refuses to let one statement update a row
  // twice. Keep the last sighting of each id.
  const byId = new Map<number, RixotDonor>();
  for (const donor of donors) byId.set(donor.id, donor);

  const { error } = await supabaseAdmin.rpc("upsert_rixot_donors", {
    p_rows: [...byId.values()].map(toRow) as Json,
  });
  if (error) throw new Error(`catalog upsert failed: ${error.message}`);
}

/**
 * Walks the whole catalog, upserting as it goes, until `deadline` passes.
 *
 * A partial sync is safe and useful: rows it did reach have a fresh
 * `last_seen_at`, and the delisting sweep only runs when the walk completed, so
 * an interrupted run can never mark a live site as gone.
 */
export async function syncCatalog(options: { deadline?: number } = {}): Promise<SyncResult> {
  const deadline = options.deadline ?? Date.now() + 100_000;
  const errors: string[] = [];
  const startedAt = new Date();

  if (!rixotConfigured()) {
    return {
      pagesFetched: 0,
      totalPages: 0,
      donorsSeen: 0,
      delisted: 0,
      complete: false,
      errors: ["Provider is not configured."],
    };
  }

  const first = await listDonors({ page: 1 });
  await writePage(first.donors);

  let pagesFetched = 1;
  let donorsSeen = first.donors.length;
  const totalPages = Math.max(1, first.totalPages);

  let next = 2;
  while (next <= totalPages && Date.now() < deadline) {
    const batch: number[] = [];
    for (let i = 0; i < CONCURRENCY && next <= totalPages; i += 1, next += 1) batch.push(next);

    const results = await Promise.allSettled(batch.map((page) => listDonors({ page })));

    // One upsert for the whole batch rather than one per page. Writing each
    // page separately serialised a database round-trip behind every twenty
    // rows, which was what actually kept the walk from finishing in a tick.
    const donors: RixotDonor[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        errors.push(`page ${batch[index]}: ${String(result.reason?.message ?? result.reason)}`);
        continue;
      }
      pagesFetched += 1;
      donorsSeen += result.value.donors.length;
      donors.push(...result.value.donors);
    }

    try {
      await writePage(donors);
    } catch (error) {
      errors.push(String(error instanceof Error ? error.message : error));
    }
  }

  // Only a complete, clean walk may delist. Anything less and a site that was
  // simply not reached this run would be hidden from the catalog.
  const complete = next > totalPages && errors.length === 0;
  let delisted = 0;
  if (complete) {
    const { data, error } = await supabaseAdmin.rpc("sweep_rixot_donors", {
      p_before: startedAt.toISOString(),
    });
    if (error) errors.push(`delist sweep failed: ${error.message}`);
    else delisted = Number(data ?? 0);
  }

  return { pagesFetched, totalPages, donorsSeen, delisted, complete, errors };
}

export type CatalogHealth = { total: number; fresh: number; lastSyncedAt: string | null };

export async function catalogHealth(): Promise<CatalogHealth> {
  const freshSince = new Date(Date.now() - FRESH_HOURS * 3600_000).toISOString();

  const [total, fresh, latest] = await Promise.all([
    supabaseAdmin
      .from("rixot_donors")
      .select("id", { count: "exact", head: true })
      .is("delisted_at", null),
    supabaseAdmin
      .from("rixot_donors")
      .select("id", { count: "exact", head: true })
      .is("delisted_at", null)
      .gte("last_seen_at", freshSince),
    supabaseAdmin
      .from("rixot_donors")
      .select("last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    total: total.count ?? 0,
    fresh: fresh.count ?? 0,
    lastSyncedAt: latest.data?.last_seen_at ?? null,
  };
}
