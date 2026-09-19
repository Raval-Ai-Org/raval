import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // The suite is skipped when the live environment is not configured.
}

const configured = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_PUBLISHABLE_KEY,
);
const BASE = "http://localhost:8080";

type Actor = { id: string; email: string; token: string; db: SupabaseClient };
const users: string[] = [];
const workspaces: string[] = [];
let admin: SupabaseClient;
let owner: Actor;
let member: Actor;
let outsider: Actor;
let workspaceId: string;

async function makeActor(tag: string): Promise<Actor> {
  const email = `client-portal-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `${randomUUID()}Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error(created.error?.message ?? "user creation failed");
  users.push(created.data.user.id);

  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session)
    throw new Error(signed.error?.message ?? "sign in failed");
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
  });
  return { id: created.data.user.id, email, token: signed.data.session.access_token, db };
}

async function rpc<T>(actor: Actor, path: string, data: unknown): Promise<T> {
  const response = await fetch(`${BASE}/api/rpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${actor.token}` },
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body.result as T;
}

async function api(actor: Actor, path: string, data: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${actor.token}` },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

(configured ? describe : describe.skip)("client portal collaboration live", () => {
  beforeAll(async () => {
    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    owner = await makeActor("owner");
    member = await makeActor("member");
    outsider = await makeActor("outsider");
    workspaceId = randomUUID();
    workspaces.push(workspaceId);

    const workspace = await admin
      .from("workspaces")
      .insert({
        id: workspaceId,
        owner_id: owner.id,
        name: "Client Portal Live",
        website_url: null,
      })
      .select("id")
      .single();
    if (workspace.error) throw new Error(workspace.error.message);
    const membership = await admin
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: owner.id, role: "owner" });
    if (membership.error) throw new Error(membership.error.message);
  }, 120_000);

  afterAll(async () => {
    for (const id of workspaces) await admin.from("workspaces").delete().eq("id", id);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("completes the owner, team, client, inbox, and revocation flow", async () => {
    const invite = await rpc<{ id: string; token: string }>(
      owner,
      "workspaces/createWorkspaceInvite",
      {
        workspaceId,
        email: member.email,
        role: "viewer",
      },
    );
    await expect(
      rpc(member, "workspaces/acceptWorkspaceInvite", { token: invite.token }),
    ).resolves.toBe(workspaceId);

    const viewerShare = await api(member, "/api/shares?action=create", {
      workspaceId,
      title: "Viewer cannot share",
      items: [{ kind: "note", title: "Draft" }],
    });
    expect(viewerShare.status).toBe(403);

    await rpc(owner, "workspaces/updateWorkspaceMemberRole", {
      workspaceId,
      userId: member.id,
      role: "editor",
    });

    const created = await api(member, "/api/shares?action=create", {
      workspaceId,
      title: "Client review",
      password: "correct horse battery staple",
      allowComments: true,
      allowApprovals: true,
      items: [{ kind: "note", title: "Draft", description: "Workspace-safe draft" }],
    });
    expect(created.status).toBe(200);
    const share = created.body as { id: string; slug: string; token: string };

    const locked = await fetch(`${BASE}/api/public/share/${share.slug}?t=${share.token}`);
    expect(locked.status).toBe(200);
    expect((await locked.json()).locked).toBe(true);
    const wrongPassword = await fetch(`${BASE}/api/public/share/${share.slug}?t=${share.token}`, {
      headers: { "X-Share-Password": "wrong password" },
    });
    expect(wrongPassword.status).toBe(401);

    const opened = await fetch(`${BASE}/api/public/share/${share.slug}?t=${share.token}`, {
      headers: { "X-Share-Password": "correct horse battery staple" },
    });
    const openedBody = await opened.json();
    expect(opened.status).toBe(200);
    expect(openedBody.items).toHaveLength(1);

    const clientMessage = await fetch(`${BASE}/api/public/share/${share.slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: share.token,
        password: "correct horse battery staple",
        kind: "commented",
        body: "Please adjust the headline",
        actorName: "Client",
      }),
    });
    expect(clientMessage.status).toBe(200);

    const inbox = await api(owner, "/api/shares?action=list", { workspaceId });
    expect(inbox.status).toBe(200);
    expect(
      inbox.body.events.some(
        (event: { body?: string }) => event.body === "Please adjust the headline",
      ),
    ).toBe(true);

    expect(
      (
        await api(owner, "/api/shares?action=reply", {
          shareId: share.id,
          body: "We will adjust it today.",
        })
      ).status,
    ).toBe(200);
    const refreshed = await fetch(`${BASE}/api/public/share/${share.slug}?t=${share.token}`, {
      headers: { "X-Share-Password": "correct horse battery staple" },
    });
    const refreshedBody = await refreshed.json();
    expect(
      refreshedBody.events.some(
        (event: { body?: string; actor_type?: string }) =>
          event.body === "We will adjust it today." && event.actor_type === "team",
      ),
    ).toBe(true);

    const approval = await fetch(`${BASE}/api/public/share/${share.slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: share.token,
        password: "correct horse battery staple",
        kind: "approved",
        itemId: refreshedBody.items[0].id,
        actorName: "Client",
      }),
    });
    expect(approval.status).toBe(200);
    const approvalInbox = await api(owner, "/api/shares?action=list", { workspaceId });
    const approvalEvent = approvalInbox.body.events.find(
      (event: { kind?: string }) => event.kind === "approved",
    );
    expect(
      (
        await api(owner, "/api/shares?action=decide", {
          eventId: approvalEvent.id,
          decision: "accepted",
        })
      ).status,
    ).toBe(200);

    expect((await api(owner, "/api/shares?action=revoke", { shareId: share.id })).status).toBe(200);
    expect((await fetch(`${BASE}/api/public/share/${share.slug}?t=${share.token}`)).status).toBe(
      410,
    );
    const reactivated = await api(owner, "/api/shares?action=reactivate", { shareId: share.id });
    expect(reactivated.status).toBe(200);
    expect(
      (
        await fetch(reactivated.body.url, {
          headers: { "X-Share-Password": "correct horse battery staple" },
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await api(outsider, "/api/shares?action=create", {
          workspaceId,
          title: "Cross tenant",
          items: [{ kind: "note", title: "Nope" }],
        })
      ).status,
    ).toBe(403);
    await rpc(owner, "workspaces/removeWorkspaceMember", { workspaceId, userId: member.id });
    const memberAccess = await member.db
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId);
    expect(memberAccess.data ?? []).toHaveLength(0);

    const revokedInvite = await rpc<{ id: string; token: string }>(
      owner,
      "workspaces/createWorkspaceInvite",
      {
        workspaceId,
        email: outsider.email,
        role: "viewer",
      },
    );
    await rpc(owner, "workspaces/revokeWorkspaceInvite", {
      workspaceId,
      inviteId: revokedInvite.id,
    });
    await expect(
      rpc(outsider, "workspaces/acceptWorkspaceInvite", { token: revokedInvite.token }),
    ).rejects.toThrow();
  }, 180_000);
});
