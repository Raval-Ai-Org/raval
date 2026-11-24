import "server-only";
// Tracked links (Round 9): makes the short links for a Studio job's captions
// and reads the click total for goals. Rows are written with the service role
// (the runner's own job, verified workspace id); members read them under RLS.
// Fails open: any error leaves the caption with its real link.
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isTrackedLinksEnabled } from "@/lib/feature-flags";
import { CLICKABLE_PLATFORMS, ownLinks, slugFrom, swapLinks } from "@/lib/links/tracked";
import type { SocialVariant } from "@/lib/studio/jobs";

type Db = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = () => supabaseAdmin as unknown as Db;

function appOrigin(): string | null {
  const raw = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  try {
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

/** The captions with own-site links swapped for short links (unchanged when off or on any error). */
export async function trackCaptionLinks(args: {
  workspaceId: string;
  jobId: string;
  website: string | null | undefined;
  variants: SocialVariant[];
}): Promise<SocialVariant[]> {
  if (!isTrackedLinksEnabled(args.workspaceId)) return args.variants;
  const origin = appOrigin();
  if (!origin) return args.variants;
  try {
    const out: SocialVariant[] = [];
    for (const v of args.variants) {
      const links = CLICKABLE_PLATFORMS.has(v.platform) ? ownLinks(v.body, args.website) : [];
      if (!links.length) {
        out.push(v);
        continue;
      }
      const rows = links.map((target_url) => ({
        workspace_id: args.workspaceId,
        job_id: args.jobId,
        platform: v.platform,
        target_url,
        slug: slugFrom(randomBytes(8)),
      }));
      const { error } = await db().from("tracked_links").insert(rows);
      if (error) {
        out.push(v);
        continue;
      }
      const short = new Map(rows.map((r) => [r.target_url, `${origin}/l/${r.slug}`]));
      const body = swapLinks(v.body, short);
      out.push({ ...v, body, chars: v.chars + (body.length - v.body.length) });
    }
    return out;
  } catch (error) {
    console.warn("[links] tracked links not made; real links kept", error);
    return args.variants;
  }
}

/** Clicks on this workspace's tracked links since a date (null when none exist or unreadable). */
export async function linkClicksSince(
  client: Db,
  workspaceId: string,
  since: string,
): Promise<number | null> {
  try {
    const { data, error } = await client
      .from("tracked_links")
      .select("clicks")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since)
      .limit(5000);
    if (error || !data?.length) return null;
    return (data as { clicks: number }[]).reduce((sum, r) => sum + (r.clicks ?? 0), 0);
  } catch {
    return null;
  }
}
