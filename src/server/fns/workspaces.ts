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
const memberMutationSchema = z.object({ workspaceId: uuidSchema, userId: uuidSchema });
const memberRoleSchema = memberMutationSchema.extend({
  role: z.enum(["admin", "editor", "viewer"]),
});
const inviteSchema = z.object({
  workspaceId: uuidSchema,
  email: z.string().trim().email().max(254),
  role: z.enum(["admin", "editor", "viewer"]),
});
const inviteIdSchema = z.object({ workspaceId: uuidSchema, inviteId: uuidSchema });

const ROLE_RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

/** Sign-in emails for the given users (service role; callers check membership first). */
async function memberEmails(userIds: string[]): Promise<Map<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out = new Map<string, string>();
  const found = await Promise.all(
    userIds.map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      return [id, data?.user?.email ?? null] as const;
    }),
  );
  for (const [id, email] of found) if (email) out.set(id, email.toLowerCase());
  return out;
}

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
  .inputValidator((data) => {
    const parsed = z.object({ token: z.string().trim() }).parse(data);
    if (!uuidSchema.safeParse(parsed.token).success) {
      throw new HttpError(404, "This invite link is not valid. Ask for a new one.");
    }
    return parsed;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = String(context.claims.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) throw new HttpError(400, "Your account has no email address to match the invite");

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("workspace_invites")
      .select("id, workspace_id, email, role, accepted_at")
      .eq("token", data.token)
      .maybeSingle();

    if (inviteError || !invite) {
      throw new HttpError(404, "This invite was cancelled or replaced. Ask for a new one.");
    }
    if (String(invite.email).toLowerCase() !== email) {
      throw new HttpError(
        403,
        `This invite is for ${invite.email}. You are signed in as ${email}. Sign in with the invited email to join.`,
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", invite.workspace_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    // Joining never lowers a role someone already has here.
    if (!existing) {
      const { error: memberError } = await supabaseAdmin.from("workspace_members").insert({
        workspace_id: invite.workspace_id,
        user_id: context.userId,
        role: invite.role as "admin" | "editor" | "viewer",
      });
      if (memberError) throw new Error("Could not join workspace");
    } else if ((ROLE_RANK[String(existing.role)] ?? 0) < (ROLE_RANK[invite.role] ?? 0)) {
      const { error: roleError } = await supabaseAdmin
        .from("workspace_members")
        .update({ role: invite.role as "admin" | "editor" | "viewer" })
        .eq("workspace_id", invite.workspace_id)
        .eq("user_id", context.userId);
      if (roleError) throw new Error("Could not join workspace");
    }

    if (!invite.accepted_at) {
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
    const [{ data: profiles, error: profilesError }, emails] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, name, avatar_url").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      memberEmails(userIds),
    ]);

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
      email: emails.get(member.user_id) ?? null,
      role: String(member.role),
      joined_at: member.created_at,
    }));
  });

export const createWorkspaceInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inviteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const email = data.email.toLowerCase();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", data.workspaceId);
    const emails = await memberEmails((members ?? []).map((m) => m.user_id));
    if ([...emails.values()].includes(email)) {
      throw new HttpError(409, `${email} is already in this workspace`);
    }

    // Inviting the same email again issues a fresh link: the old one stops
    // working, and someone removed earlier can join again (accepted_at resets).
    const { data: invite, error } = await context.supabase
      .from("workspace_invites")
      .upsert(
        {
          workspace_id: data.workspaceId,
          email,
          role: data.role,
          invited_by: context.userId,
          token: crypto.randomUUID(),
          accepted_at: null,
        },
        { onConflict: "workspace_id,email" },
      )
      .select("id, token, email, role")
      .single();
    if (error || !invite) throw new Error("Could not create invite");
    return invite;
  });

export const revokeWorkspaceInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inviteIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const { error } = await context.supabase
      .from("workspace_invites")
      .delete()
      .eq("id", data.inviteId)
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error("Could not revoke invite");
    return { ok: true };
  });

export const updateWorkspaceMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => memberRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "owner");
    const { data: updated, error } = await context.supabase
      .from("workspace_members")
      .update({ role: data.role })
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.userId)
      .select("user_id, role");
    if (error || !updated?.length) throw new Error("Could not change member role");
    return updated[0];
  });

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => memberMutationSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "owner");
    const { error } = await context.supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.userId);
    if (error) throw new Error("Could not remove member");
    return { ok: true };
  });
