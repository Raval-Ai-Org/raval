import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuidSchema = z.string().uuid();

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().max(2048).optional().nullable(),
});

const renameWorkspaceSchema = z.object({
  workspaceId: uuidSchema,
  name: z.string().trim().min(1).max(120),
});

export const renameWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => renameWorkspaceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workspaces")
      .update({ name: data.name })
      .eq("id", data.workspaceId);
    if (error) throw new Error("Could not rename workspace");
    return { ok: true, name: data.name };
  });

export const getWorkspaceDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuidSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: ws, error } = await context.supabase
      .from("workspaces")
      .select("id, name, plan, website_url, industry, created_at, owner_id")
      .eq("id", data.workspaceId)
      .maybeSingle();
    if (error || !ws) throw new Error("Workspace not found");
    const { count: memberCount } = await context.supabase
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", data.workspaceId);
    return {
      id: ws.id,
      name: ws.name,
      plan: ws.plan ?? "free",
      websiteUrl: ws.website_url,
      industry: ws.industry,
      createdAt: ws.created_at,
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
    const { error } = await context.supabase
      .from("approvals")
      .update({ status: data.decision, decided_at: new Date().toISOString() })
      .eq("id", data.approvalId);
    if (error) throw new Error("Could not update approval");
    return { ok: true };
  });

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => createWorkspaceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from("workspaces")
      .insert({
        owner_id: context.userId,
        name: data.name,
        website_url: data.websiteUrl?.trim() || null,
      })
      .select("id")
      .single();

    if (workspaceError || !workspace) {
      throw new Error("Could not create project");
    }

    const { error: memberError } = await supabaseAdmin.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: context.userId,
      role: "owner",
    });

    if (memberError) {
      await supabaseAdmin.from("workspaces").delete().eq("id", workspace.id);
      throw new Error("Could not create project membership");
    }

    return workspace.id;
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

    // Do NOT auto-create a workspace. New users must create their first client
    // explicitly on /projects so we never show empty placeholder workspaces.
    const { data: existing } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return existing?.workspace_id ?? null;
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
