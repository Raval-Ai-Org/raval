import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeDomain } from "@/lib/workspace/domain";
import { rateLimitFor } from "@/server/rate-limit";
import { ForbiddenError, HttpError } from "@/server/http-error";
import { getWorkspaceRole, requireWorkspaceRole } from "@/server/workspace-access.server";

const uuidSchema = z.string().uuid();

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().max(2048).optional().nullable(),
  /** One key per create attempt: retries, double clicks and refreshes replay it. */
  idempotencyKey: z.string().trim().min(8).max(100).optional().nullable(),
});

const renameWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(120),
});

export const renameWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => renameWorkspaceSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { data: updated, error } = await context.supabase
      .from("workspaces")
      .update({ name: data.name })
      .eq("id", data.workspaceId)
      .select("id");
    if (error) throw new Error("Could not rename workspace");
    // RLS filters an update the caller may not make: zero rows is a refusal.
    if (!updated?.length) throw new ForbiddenError("Only the workspace owner can rename it");
    return { ok: true, name: data.name };
  });

export const getWorkspaceDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuidSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: ws, error } = await context.supabase
      .from("workspaces")
      .select("id, name, plan, website_url, industry, created_at, owner_id, onboarded_at")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (error || !ws) throw new HttpError(404, "Workspace not found");
    const role = await getWorkspaceRole(context, data.workspaceId);
    if (!role) throw new HttpError(404, "Workspace not found");
    const { count: memberCount } = await context.supabase
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", data.workspaceId);
    return {
      id: ws.id,
      name: ws.name,
      plan: ws.plan ?? "free",
      websiteUrl: ws.website_url,
      domain: normalizeDomain(ws.website_url),
      industry: ws.industry,
      createdAt: ws.created_at,
      onboarded: Boolean(ws.onboarded_at),
      role,
      isOwner: ws.owner_id === context.userId,
      memberCount: memberCount ?? 1,
    };
  });

export const listApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuidSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("approvals")
      .select("id, action, status, payload, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load approvals");
    return rows ?? [];
  });

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        approvalId: uuidSchema,
        decision: z.enum(["approved", "rejected"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase
      .from("approvals")
      .update({ status: data.decision, decided_at: new Date().toISOString() })
      .eq("id", data.approvalId)
      .select("id");
    if (error) throw new Error("Could not update approval");
    // RLS silently filters an update the caller may not make (viewer, other
    // workspace): zero rows is a refusal, not a success.
    if (!updated?.length) throw new Error("Forbidden: you can't decide this approval");
    return { ok: true };
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("workspace-lifecycle")])
  .inputValidator((data) => createWorkspaceSchema.parse(data))
  .handler(async ({ data, context }) => {
    // The site URL is crawled later (brand extract, coach, geo audit), so a
    // private or loopback address is refused at the point it is saved too.
    const websiteUrl = data.websiteUrl?.trim() || null;
    if (websiteUrl) {
      const { assertPublicUrl } = await import("@/server/safe-fetch");
      try {
        assertPublicUrl(websiteUrl);
      } catch {
        throw new HttpError(400, "Website must be a public http(s) address");
      }
    }
    const { createOrGetWorkspace } = await import("@/server/workspaces/service.server");
    return createOrGetWorkspace({
      userId: context.userId,
      name: data.name,
      websiteUrl,
      idempotencyKey: data.idempotencyKey ?? null,
    });
  });

/** Every workspace the caller belongs to, with per-workspace metrics. */
export const listWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listAuthorizedWorkspaces } = await import("@/server/workspaces/service.server");
    return listAuthorizedWorkspaces(context.supabase as never, context.userId);
  });

export const deleteWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("workspace-lifecycle")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuidSchema, confirmation: z.string().max(40) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const service = await import("@/server/workspaces/service.server");
    return service.deleteWorkspace({
      workspaceId: data.workspaceId,
      userId: context.userId,
      confirmation: data.confirmation,
    });
  });

export const ensureAuthWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const metadata = (context.claims.user_metadata ?? {}) as Record<string, unknown>;
    const email = typeof context.claims.email === "string" ? context.claims.email : "";
    const nameFromMeta =
      (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
      (typeof metadata.name === "string" && metadata.name.trim()) ||
      (email ? email.split("@")[0] : "New user");
    const avatarFromMeta =
      (typeof metadata.avatar_url === "string" && metadata.avatar_url) ||
      (typeof metadata.picture === "string" && metadata.picture) ||
      null;

    await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: context.userId, name: nameFromMeta, avatar_url: avatarFromMeta },
        { onConflict: "id" },
      );

    // Never auto-create or pick a workspace: sign-in lands on /projects and
    // the user chooses one explicitly.
    return null;
  });

export const acceptWorkspaceInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ token: uuidSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = String(context.claims.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) throw new Error("Could not verify invite email");

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("workspace_invites")
      .select("id, workspace_id, email, role, accepted_at")
      .eq("token", data.token)
      .maybeSingle();

    if (inviteError || !invite) throw new Error("Invite not found");
    if (String(invite.email).toLowerCase() !== email) {
      throw new Error("Invite email does not match your account");
    }

    if (!invite.accepted_at) {
      const { error: memberError } = await supabaseAdmin.from("workspace_members").upsert(
        {
          workspace_id: invite.workspace_id,
          user_id: context.userId,
          role: invite.role as "admin" | "editor" | "viewer",
        },
        { onConflict: "workspace_id,user_id" },
      );
      if (memberError) throw new Error("Could not join workspace");

      await supabaseAdmin
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
    }

    return invite.workspace_id;
  });

export const getWorkspaceMemberProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuidSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (membershipError || !membership) throw new Error("Not allowed");

    const { data: members, error: membersError } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id, role, created_at")
      .eq("workspace_id", data.workspaceId)
      .order("created_at", { ascending: true });

    if (membersError) throw new Error("Could not load members");

    const userIds = (members ?? []).map((member) => member.user_id);
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, avatar_url").in("id", userIds)
      : { data: [], error: null };

    if (profilesError) throw new Error("Could not load member profiles");

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    return (members ?? []).map((member) => ({
      ...(() => {
        const profile = profileById.get(member.user_id);
        return {
          name: profile?.name ?? null,
          avatar_url: profile?.avatar_url ?? null,
        };
      })(),
      user_id: member.user_id,
      role: String(member.role),
      joined_at: member.created_at,
    }));
  });
