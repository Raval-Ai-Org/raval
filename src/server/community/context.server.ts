// context.server.ts — what Community Intelligence knows about a brand, read
// from the rows the workspace already has: Brand DNA, products, audience
// groups' pains, tracked competitors, the goal and the person's watches.
// The worker calls it with the service role for one verified workspace id.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hostOf } from "@/lib/research/sources";
import type { QueryContext } from "@/lib/community/queries";

const db = () => supabaseAdmin as unknown as SupabaseClient;

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown, max: number): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim())
      .slice(0, max);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n;•]+|,(?=\s)/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}

export type CommunityBrand = QueryContext & {
  /** Plain lines the reply writer may rely on (DNA and catalogue). */
  facts: string;
};

/** Names of the workspace's tracked competitors. */
export async function trackedCompetitorNames(workspaceId: string): Promise<string[]> {
  const { data } = await db()
    .from("workspace_competitors")
    .select("name")
    .eq("workspace_id", workspaceId)
    .eq("status", "tracked")
    .order("created_at")
    .limit(12);
  return ((data ?? []) as { name: string }[]).map((r) => r.name).filter(Boolean);
}

export async function loadCommunityBrand(workspaceId: string): Promise<CommunityBrand> {
  const [dnaRow, ws, products, twins, goals, watches, competitors] = await Promise.all([
    db().from("workspace_brand_dna").select("dna").eq("workspace_id", workspaceId).maybeSingle(),
    db().from("workspaces").select("name, website_url").eq("id", workspaceId).maybeSingle(),
    db()
      .from("workspace_products")
      .select("name, description, price")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("position")
      .limit(12),
    db()
      .from("audience_twins")
      .select("profile")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(8),
    db().from("workspace_goals").select("goals").eq("workspace_id", workspaceId).maybeSingle(),
    db().from("community_watches").select("kind, value").eq("workspace_id", workspaceId).limit(40),
    trackedCompetitorNames(workspaceId),
  ]);

  const dna = ((dnaRow.data as { dna?: unknown } | null)?.dna ?? {}) as Record<string, unknown>;
  const workspace = (ws.data ?? {}) as { name?: string; website_url?: string };
  const site = text(workspace.website_url, 300) || text(dna.websiteUrl, 300);
  const domain = site ? hostOf(site.startsWith("http") ? site : `https://${site}`) || null : null;
  const productRows = (products.data ?? []) as {
    name: string;
    description: string;
    price: string;
  }[];

  // Audience pains are the customers' own problems — the best questions to look for.
  const pains: string[] = [];
  for (const row of (twins.data ?? []) as { profile: unknown }[]) {
    for (const trait of Array.isArray(row.profile) ? row.profile : []) {
      const t = trait as { kind?: string; text?: string };
      if (t.kind === "pain" && typeof t.text === "string") pains.push(t.text);
    }
  }
  const watchRows = (watches.data ?? []) as { kind: string; value: string }[];
  const goalFocus = text((goals.data as { goals?: { focus?: unknown } } | null)?.goals?.focus, 20);

  const brandName = text(dna.brandName) || text(workspace.name) || domain || "";
  const facts = [
    brandName && `Brand: ${brandName}`,
    domain && `Website: ${domain}`,
    text(dna.oneLiner, 300) && `One-liner: ${text(dna.oneLiner, 300)}`,
    text(dna.about, 800) && `About: ${text(dna.about, 800)}`,
    text(dna.products, 600) && `Products: ${text(dna.products, 600)}`,
    text(dna.uniqueValueProp, 300) && `What makes it different: ${text(dna.uniqueValueProp, 300)}`,
    ...productRows.map((p) =>
      [`- ${p.name}`, p.price, p.description?.slice(0, 160)].filter(Boolean).join(" — "),
    ),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    brandName,
    domain,
    category: text(dna.industry) || text(dna.category),
    keywords: list(dna.keywords, 6),
    products: productRows.map((p) => p.name).slice(0, 4),
    problems: [...list(dna.painPoints, 4), ...pains].slice(0, 8),
    competitors,
    goalFocus: goalFocus || null,
    watchKeywords: watchRows.filter((w) => w.kind === "keyword").map((w) => w.value),
    watchCommunities: watchRows.filter((w) => w.kind === "community").map((w) => w.value),
    facts,
  };
}
