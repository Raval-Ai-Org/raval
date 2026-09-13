// workspace.server.ts — per-workspace SocialAPI.ai wiring (server-only):
// the provider client from env, workspace ↔ brand provisioning, and the plan
// post-credit quota. Routes call getSocialApiDeps(workspaceId) and hand the
// result to the pure handlers.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPlanLimits } from "@/server/plans";
import { createSocialApiClient, type SocialApiCall } from "@/lib/socialapi/client.server";
import { DistributionError, type PostQuota, type SocialApiDeps } from "@/lib/socialapi/handlers";

// The typed client doesn't know tables added after the last type generation
// run in every environment; these modules only touch the SocialAPI tables.
const db = supabaseAdmin as any;

let client: SocialApiCall | null = null;

export function getSocialApiClient(): SocialApiCall {
  if (!client) {
    client = createSocialApiClient({
      apiKey: process.env.SOCIALAPI_API_KEY ?? "",
      baseUrl: process.env.SOCIALAPI_BASE_URL || undefined,
    });
  }
  return client;
}

/** Tests / key rotation. */
export function resetSocialApiClient(): void {
  client = null;
}

const PROVISION_WAIT_MS = 400;
const PROVISION_STALE_MS = 2 * 60 * 1000;

function brandName(workspaceName: string | null, workspaceId: string): string {
  const base = (workspaceName ?? "Workspace").trim().slice(0, 60) || "Workspace";
  // Brand names aren't unique at the provider; the id suffix makes ours findable.
  return `${base} · Mellox ${workspaceId.slice(0, 8)}`;
}

/**
 * The workspace's SocialAPI brand id, creating it on first use. Brand creation
 * is not idempotent at the provider, so a row is claimed first (unique
 * workspace_id) and only the claimer creates; a crash between create and
 * persist is recovered by finding the brand by its suffixed name.
 */
export async function ensureWorkspaceBrand(
  workspaceId: string,
  api: SocialApiCall = getSocialApiClient(),
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: row } = await db
      .from("workspace_socialapi")
      .select("brand_id, status, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (row?.brand_id && row.status === "active") return row.brand_id as string;

    if (!row) {
      const { error } = await db
        .from("workspace_socialapi")
        .insert({ workspace_id: workspaceId, status: "provisioning" });
      if (error && !/duplicate key|23505/.test(`${error.code} ${error.message}`)) {
        throw new DistributionError(
          500,
          "UNKNOWN",
          "Couldn't prepare social publishing for this workspace.",
        );
      }
      if (error) {
        await new Promise((r) => setTimeout(r, PROVISION_WAIT_MS));
        continue; // another request claimed it
      }
      return provisionBrand(workspaceId, api);
    }
    // Someone else is provisioning; wait, unless their claim went stale or errored.
    const stale = Date.now() - Date.parse(row.updated_at) > PROVISION_STALE_MS;
    if (row.status === "error" || stale) return provisionBrand(workspaceId, api);
    await new Promise((r) => setTimeout(r, PROVISION_WAIT_MS));
  }
  throw new DistributionError(
    503,
    "DISTRIBUTION_UNAVAILABLE",
    "Social publishing is still being set up. Try again in a moment.",
  );
}

async function provisionBrand(workspaceId: string, api: SocialApiCall): Promise<string> {
  const touch = (patch: Record<string, unknown>) =>
    db
      .from("workspace_socialapi")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
  await touch({ status: "provisioning", last_error: null });

  const { data: ws } = await db
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  const name = brandName(ws?.name ?? null, workspaceId);

  const list = await api<{ data?: Array<{ id: string; name: string; accounts_count?: number }> }>({
    path: "/brands",
    retry: true,
  });
  if (list.status !== 200) {
    await touch({ status: "error", last_error: `list brands: ${list.status}` });
    throw new DistributionError(
      503,
      "DISTRIBUTION_UNAVAILABLE",
      "The publishing provider is unavailable. Try again shortly.",
    );
  }
  const brands = list.data?.data ?? [];
  let brandId = brands.find((b) => b.name === name)?.id ?? null;

  if (!brandId) {
    // The provider account starts with an unused "Default" brand; adopting it
    // (instead of creating another) saves a billed profile unit.
    const { data: mapped } = await db
      .from("workspace_socialapi")
      .select("brand_id")
      .not("brand_id", "is", null);
    const taken = new Set(((mapped ?? []) as Array<{ brand_id: string }>).map((m) => m.brand_id));
    const unused = brands.find(
      (b) => b.name === "Default" && !b.accounts_count && !taken.has(b.id),
    );
    if (unused) {
      const renamed = await api({
        method: "PATCH",
        path: `/brands/${encodeURIComponent(unused.id)}`,
        body: { name },
      });
      if (renamed.status === 200) brandId = unused.id;
    }
  }

  if (!brandId) {
    const created = await api<{ id?: string; error?: { code?: string; message?: string } }>({
      method: "POST",
      path: "/brands",
      body: { name },
    });
    if (created.status !== 201 || !created.data?.id) {
      const code = created.data?.error?.code ?? "";
      await touch({
        status: "error",
        last_error: `create brand: ${created.status} ${code}`.slice(0, 300),
      });
      if (/limit|billing/.test(code) || created.status === 403) {
        throw new DistributionError(
          403,
          "PROVIDER_BILLING",
          "Social publishing has reached its workspace limit. An administrator needs to upgrade the SocialAPI plan.",
        );
      }
      throw new DistributionError(
        503,
        "DISTRIBUTION_UNAVAILABLE",
        "Couldn't set up social publishing for this workspace.",
      );
    }
    brandId = created.data.id;
  }

  const { error } = await touch({ brand_id: brandId, status: "active" });
  if (error)
    throw new DistributionError(500, "UNKNOWN", "Couldn't save the social publishing setup.");
  return brandId;
}

/** Plan quota backed by the social_usage_events ledger (UTC calendar month). */
export const socialPostQuota: PostQuota = {
  async check(workspaceId, needed) {
    const used = await monthlyPostUsage(workspaceId);
    const limit = await monthlyPostLimit(workspaceId);
    return { ok: used + needed <= limit, used, limit };
  },
  async record(event) {
    const { error } = await db.from("social_usage_events").insert({
      workspace_id: event.workspaceId,
      provider: "socialapi",
      operation: event.operation,
      provider_post_id: event.providerPostId,
      content_item_id: event.contentItemId,
      user_id: event.userId,
      targets: event.targets,
    });
    if (error) throw new Error(error.message);
  },
};

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function monthlyPostUsage(workspaceId: string): Promise<number> {
  const { count, error } = await db
    .from("social_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStartIso());
  if (error) throw new DistributionError(500, "UNKNOWN", "Couldn't check publishing credits.");
  return count ?? 0;
}

export async function monthlyPostLimit(workspaceId: string): Promise<number> {
  const { data } = await db.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle();
  return getPlanLimits(data?.plan ?? null).monthlyPosts;
}

export async function getSocialApiDeps(workspaceId: string): Promise<SocialApiDeps> {
  const api = getSocialApiClient();
  const brandId = await ensureWorkspaceBrand(workspaceId, api);
  return { api, db, brandId, quota: socialPostQuota };
}

export { db as socialDb };
