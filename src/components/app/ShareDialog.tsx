"use client";

import { workspacePath } from "@/lib/workspace/paths";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { useEffect, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Slot } from "@radix-ui/react-slot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Link as LinkIcon,
  Check,
  Users,
  Loader2,
  Mail,
  X,
  Crown,
  Shield,
  Eye,
  Pencil,
  Send,
  UserPlus,
} from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import {
  createWorkspaceInvite,
  getWorkspaceMemberProfiles,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateWorkspaceMemberRole,
} from "@/lib/workspaces.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Member = {
  user_id: string;
  role: string;
  name: string | null;
  avatar_url: string | null;
  joined_at: string;
  email?: string | null;
  isYou?: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  created_at: string;
};

const initials = (n?: string | null, e?: string | null) => {
  const s = (n ?? e ?? "U").trim();
  const parts = s.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
};

const inviteLink = (baseUrl: string, token: string) => `${baseUrl}/app?invite_token=${token}`;

/** Opens the user's own email app with the invite filled in. */
const inviteMailto = (email: string, link: string, workspaceName: string | null) => {
  const subject = workspaceName ? `Join ${workspaceName} on Mellox` : "Join my workspace on Mellox";
  const body = [
    "Hi,",
    "",
    `I've invited you to ${workspaceName ? `the ${workspaceName} workspace` : "my workspace"} on Mellox.`,
    `Open this link and sign in (or sign up) with ${email}:`,
    link,
  ].join("\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

const roleIcon = (r: string) =>
  r === "owner" ? Crown : r === "admin" ? Shield : r === "viewer" ? Eye : Pencil;

const roleTone = (r: string) =>
  r === "owner"
    ? "text-amber-500"
    : r === "admin"
      ? "text-[hsl(var(--brand-blue))]"
      : r === "viewer"
        ? "text-muted-foreground"
        : "text-foreground/70";

export function ShareDialog({
  workspaceId,
  children,
}: {
  workspaceId: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:share", h);
    return () => removeAppEventListener("open:share", h);
  }, []);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ email: string; link: string } | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [canManageInvites, setCanManageInvites] = useState(false);
  const getWorkspaceMemberProfilesFn = useServerFn(getWorkspaceMemberProfiles);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const workspaceLink = workspaceId ? `${baseUrl}${workspacePath(workspaceId)}` : "";

  const refresh = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [{ data: sess }, mres, ires, wres] = await Promise.all([
        supabase.auth.getUser(),
        getWorkspaceMemberProfilesFn({ data: { workspaceId } }),
        supabase
          .from("workspace_invites")
          .select("id, email, role, token, accepted_at, created_at")
          .eq("workspace_id", workspaceId)
          .is("accepted_at", null)
          .order("created_at", { ascending: false }),
        supabase.from("workspaces").select("owner_id, name").eq("id", workspaceId).maybeSingle(),
      ]);
      const me = sess.user;
      const rows: Member[] = (mres ?? []).map((m: any) => ({
        user_id: m.user_id,
        role: m.role,
        name: m.name,
        avatar_url: m.avatar_url,
        joined_at: m.joined_at,
        email: m.email ?? (m.user_id === me?.id ? (me?.email ?? null) : null),
        isYou: m.user_id === me?.id,
      }));
      rows.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
      setMembers(rows);
      setInvites((ires.data as Invite[]) ?? []);
      setIsOwner(!!me && wres.data?.owner_id === me.id);
      setWorkspaceName(wres.data?.name ?? null);
      setCanManageInvites(
        !!me && rows.some((row) => row.user_id === me.id && ["owner", "admin"].includes(row.role)),
      );
    } catch (e: any) {
      toast.error("Could not load members", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const invite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (!workspaceId) return;
    if (members.some((m) => (m.email ?? "").toLowerCase() === trimmed)) {
      toast.info("Already a member", { description: `${trimmed} is already in this workspace.` });
      return;
    }
    setInviting(true);
    try {
      const data = await createWorkspaceInvite({ data: { workspaceId, email: trimmed, role } });
      const link = inviteLink(baseUrl, data.token);
      setLastInvite({ email: trimmed, link });
      try {
        await navigator.clipboard.writeText(link);
        toast.success(`Invite ready for ${trimmed}`, {
          description: "Link copied. Send it by email or chat.",
        });
      } catch {
        toast.success(`Invite ready for ${trimmed}`, {
          description: "Copy the link below and send it.",
        });
      }
      setEmail("");
      refresh();
    } catch (e: any) {
      toast.error("Could not create invite", { description: e?.message });
    } finally {
      setInviting(false);
    }
  };

  const revoke = async (id: string) => {
    const prev = invites;
    setInvites((xs) => xs.filter((x) => x.id !== id));
    try {
      await revokeWorkspaceInvite({ data: { workspaceId: workspaceId!, inviteId: id } });
    } catch {
      setInvites(prev);
      return toast.error("Could not cancel invite");
    }
    if (lastInvite && prev.find((x) => x.id === id)?.email === lastInvite.email) {
      setLastInvite(null);
    }
    toast.success("Invite cancelled", { description: "That link no longer works." });
  };

  const removeMember = async (userId: string) => {
    if (!workspaceId) return;
    const prev = members;
    setMembers((xs) => xs.filter((m) => m.user_id !== userId));
    try {
      await removeWorkspaceMember({ data: { workspaceId, userId } });
    } catch {
      setMembers(prev);
      return toast.error("Could not remove member");
    }
    toast.success("Member removed");
  };

  const changeRole = async (userId: string, nextRole: "admin" | "editor" | "viewer") => {
    if (!workspaceId) return;
    const previous = members;
    setMembers((rows) => rows.map((m) => (m.user_id === userId ? { ...m, role: nextRole } : m)));
    try {
      await updateWorkspaceMemberRole({ data: { workspaceId, userId, role: nextRole } });
      toast.success("Role updated");
    } catch (e: any) {
      setMembers(previous);
      toast.error("Could not change role", { description: e?.message });
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <>
      <Slot onClick={() => setOpen(true)}>{children as any}</Slot>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="sm"
        Icon={UserPlus}
        title="Invite to workspace"
        description="Work on this workspace together"
        srDescription="Share workspace and manage members"
        bodyClassName="px-6 py-5"
      >
        <div className="space-y-5">
          {/* Invite form */}
          <section aria-labelledby="invite-heading" className="space-y-2">
            <div
              id="invite-heading"
              className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            >
              <Send className="h-3 w-3" /> Send an invite
            </div>
            <div className="flex items-stretch gap-2">
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute z-10 left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") invite();
                  }}
                  placeholder="name@company.com"
                  disabled={!canManageInvites || inviting}
                  aria-label="Teammate email"
                  className="h-9 bg-background/60 pl-8 text-[12.5px]"
                />
              </div>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as any)}
                disabled={!canManageInvites || inviting}
              >
                <SelectTrigger
                  className="h-9 w-[112px] bg-background/60 text-[12px]"
                  aria-label="Role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">
                    <span className="flex items-center gap-1.5">
                      <Pencil className="h-3 w-3" /> Editor
                    </span>
                  </SelectItem>
                  <SelectItem value="admin">
                    <span className="flex items-center gap-1.5">
                      <Shield className="h-3 w-3" /> Admin
                    </span>
                  </SelectItem>
                  <SelectItem value="viewer">
                    <span className="flex items-center gap-1.5">
                      <Eye className="h-3 w-3" /> Viewer
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={invite}
                disabled={inviting || !email.trim() || !canManageInvites}
                className="btn-aura h-9 rounded-md px-3.5 text-[12px] font-semibold"
              >
                {inviting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Inviting
                  </>
                ) : (
                  <>
                    <Send className="mr-1.5 h-3.5 w-3.5" /> Invite
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {canManageInvites ? (
                <>
                  <span className="font-medium text-foreground/80">Editors</span> can create and
                  edit content · <span className="font-medium text-foreground/80">Viewers</span>{" "}
                  have read-only access.
                </>
              ) : (
                <>Only admins and the owner can invite people.</>
              )}
            </p>
          </section>

          {lastInvite && (
            <section
              aria-label="Invite ready"
              className="space-y-2 rounded-xl border border-[hsl(var(--brand-green)/0.35)] bg-[hsl(var(--brand-green)/0.06)] p-3"
            >
              <div className="text-[12px] font-medium text-foreground">
                Invite ready for {lastInvite.email}
              </div>
              <div className="flex items-stretch gap-2 rounded-lg border border-border/60 bg-background/70 p-1 pl-3">
                <span className="flex-1 truncate self-center text-[11.5px] text-muted-foreground">
                  {lastInvite.link}
                </span>
                <Button
                  onClick={() => copy(lastInvite.link, "last-invite")}
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-[11.5px] font-medium"
                >
                  {copied === "last-invite" ? (
                    <>
                      <Check className="mr-1 h-3 w-3 text-[hsl(var(--brand-green))]" /> Copied
                    </>
                  ) : (
                    <>
                      <LinkIcon className="mr-1 h-3 w-3" /> Copy
                    </>
                  )}
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-[11.5px] font-medium"
                >
                  <a href={inviteMailto(lastInvite.email, lastInvite.link, workspaceName)}>
                    <Mail className="mr-1 h-3 w-3" /> Email
                  </a>
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                They sign in or sign up with this email, then join right away.
              </p>
            </section>
          )}

          {/* Link for people already in the workspace */}
          <section aria-labelledby="link-heading" className="space-y-2">
            <div
              id="link-heading"
              className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            >
              <LinkIcon className="h-3 w-3" /> Workspace link (members only)
            </div>
            <div className="flex items-stretch gap-2 rounded-lg border border-border/60 bg-background/50 p-1 pl-3">
              <span className="flex-1 truncate self-center text-[12px] text-muted-foreground">
                {workspaceLink || "—"}
              </span>
              <Button
                onClick={() => copy(workspaceLink, "workspace")}
                variant="ghost"
                size="sm"
                disabled={!workspaceLink}
                className="h-7 rounded-md px-2.5 text-[11.5px] font-medium"
              >
                {copied === "workspace" ? (
                  <>
                    <Check className="mr-1 h-3 w-3 text-[hsl(var(--brand-green))]" /> Copied
                  </>
                ) : (
                  <>
                    <LinkIcon className="mr-1 h-3 w-3" /> Copy
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* Members */}
          <section aria-labelledby="members-heading">
            <div id="members-heading" className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Users className="h-3 w-3" /> People with access
                <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-foreground/70">
                  {members.length}
                </span>
              </div>
              {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>

            <div className="max-h-[260px] space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
              {members.map((m) => {
                const RoleIcon = roleIcon(m.role);
                return (
                  <div
                    key={m.user_id}
                    className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-secondary/60"
                  >
                    <Avatar className="h-8 w-8 ring-1 ring-border/60">
                      {m.avatar_url && <AvatarImage src={m.avatar_url} alt={m.name ?? ""} />}
                      <AvatarFallback className="bg-gradient-to-br from-[hsl(var(--brand-green)/0.3)] to-[hsl(var(--brand-blue)/0.3)] text-[10.5px] font-semibold">
                        {initials(m.name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-foreground">
                        {m.name ?? m.email ?? "Member"}
                        {m.isYou && (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      {m.email && (
                        <div className="truncate text-[11px] text-muted-foreground">{m.email}</div>
                      )}
                    </div>
                    {isOwner && !m.isYou && m.role !== "owner" ? (
                      <Select
                        value={m.role}
                        onValueChange={(value) =>
                          changeRole(m.user_id, value as "admin" | "editor" | "viewer")
                        }
                      >
                        <SelectTrigger
                          className="h-7 w-[94px] text-[11px]"
                          aria-label={`Role for ${m.name ?? "member"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] capitalize text-muted-foreground">
                        <RoleIcon className={cn("h-3 w-3", roleTone(m.role))} />
                        {m.role}
                      </span>
                    )}
                    {isOwner && !m.isYou && m.role !== "owner" && (
                      <button
                        onClick={() => removeMember(m.user_id)}
                        className="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                        title="Remove member"
                        aria-label={`Remove ${m.name ?? m.email ?? "member"}`}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    )}
                  </div>
                );
              })}

              {invites.length > 0 && (
                <div className="mt-2 border-t border-dashed border-border/60 pt-2">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Pending invites
                    <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-foreground/70">
                      {invites.length}
                    </span>
                  </div>
                  {invites.map((inv) => {
                    const link = inviteLink(baseUrl, inv.token);
                    return (
                      <div
                        key={inv.id}
                        className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-secondary/60"
                      >
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-foreground/70">
                          <Mail className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-foreground">
                            {inv.email}
                          </div>
                          <div className="text-[11px] capitalize text-muted-foreground">
                            Pending · {inv.role}
                          </div>
                        </div>
                        <button
                          onClick={() => copy(link, inv.id)}
                          title="Copy invite link"
                          className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
                        >
                          {copied === inv.id ? (
                            <span className="flex items-center gap-1 text-[hsl(var(--brand-green))]">
                              <Check className="h-3 w-3" /> Copied
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <LinkIcon className="h-3 w-3" /> Link
                            </span>
                          )}
                        </button>
                        <a
                          href={inviteMailto(inv.email, link, workspaceName)}
                          title="Email invite"
                          aria-label={`Email invite to ${inv.email}`}
                          className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
                        >
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> Email
                          </span>
                        </a>
                        {canManageInvites && (
                          <button
                            onClick={() => revoke(inv.id)}
                            title="Cancel invite"
                            aria-label={`Cancel invite for ${inv.email}`}
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!loading && members.length === 0 && invites.length === 0 && (
                <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-[11.5px] text-muted-foreground">
                  No teammates yet — invite your first collaborator above.
                </div>
              )}
            </div>
          </section>
        </div>
      </AppModalShell>
    </>
  );
}
