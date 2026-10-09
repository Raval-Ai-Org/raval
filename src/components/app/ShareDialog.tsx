"use client";

// Team invites (Share → Invite teammates). An invite is a link for one email
// address: Mellox emails it when it can, and the link is always there to copy.
// Admins and the owner invite; only the owner changes roles or removes people.

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Slot } from "@radix-ui/react-slot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Link as LinkIcon, Mail, UserPlus, X } from "@/components/ui/gemini-icons";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { supabase } from "@/integrations/supabase/client";
import {
  createWorkspaceInvite,
  getWorkspaceMemberProfiles,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateWorkspaceMemberRole,
} from "@/lib/workspaces.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Role = "admin" | "editor" | "viewer";

type Member = {
  user_id: string;
  role: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  isYou: boolean;
};

type Invite = { id: string; email: string; role: string; token: string };

const INVITE_PAGE_SIZE = 10;

const ROLE_HINT: Record<Role, string> = {
  admin: "Can do everything, and invite people",
  editor: "Can create, edit and publish",
  viewer: "Can look, but not change anything",
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);
/** A plan limit already shows its own upgrade notice, so no second message. */
const isBillingBlock = (error: unknown) => error instanceof ServerFnError && error.status === 402;

const initials = (name?: string | null, email?: string | null) => {
  const source = (name ?? email ?? "U").trim();
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

const inviteLink = (token: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/app?invite_token=${token}`;

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
  const [role, setRole] = useState<Role>("editor");
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState<{
    email: string;
    link: string;
    emailed: boolean;
  } | null>(null);

  const [members, setMembers] = useState<Member[] | null>(null);
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberPageSize, setMemberPageSize] = useState(10);
  const [membersError, setMembersError] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const memberRequest = useRef(0);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteTotal, setInviteTotal] = useState(0);
  const [invitePage, setInvitePage] = useState(1);
  const inviteRequest = useRef(0);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const getMembers = useServerFn(getWorkspaceMemberProfiles);

  const loadMembers = async (page = memberPage) => {
    if (!workspaceId) return;
    const request = ++memberRequest.current;
    setMembersError(false);
    try {
      const [{ data: session }, result, workspace] = await Promise.all([
        supabase.auth.getUser(),
        getMembers({ data: { workspaceId, page } }),
        supabase.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle(),
      ]);
      if (request !== memberRequest.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
      if (page > lastPage) return void loadMembers(lastPage);
      const me = session.user;
      setMembers(
        result.members.map((m) => ({
          user_id: m.user_id,
          role: m.role,
          name: m.name,
          avatar_url: m.avatar_url,
          email: m.email ?? (m.user_id === me?.id ? (me?.email ?? null) : null),
          isYou: m.user_id === me?.id,
        })),
      );
      setMemberPage(page);
      setMemberTotal(result.total);
      setMemberPageSize(result.pageSize);
      setIsOwner(!!me && workspace.data?.owner_id === me.id);
      setCanInvite(["owner", "admin"].includes(result.currentRole));
    } catch {
      if (request === memberRequest.current) setMembersError(true);
    }
  };

  // Only admins and the owner can read invites (RLS), so others see none.
  const loadInvites = async (page = invitePage) => {
    if (!workspaceId) return;
    const request = ++inviteRequest.current;
    const { data, count, error } = await supabase
      .from("workspace_invites")
      .select("id, email, role, token", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * INVITE_PAGE_SIZE, page * INVITE_PAGE_SIZE - 1);
    if (request !== inviteRequest.current || error) return;
    const total = count ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / INVITE_PAGE_SIZE));
    if (page > lastPage) return void loadInvites(lastPage);
    setInvites((data as Invite[]) ?? []);
    setInviteTotal(total);
    setInvitePage(page);
  };

  useEffect(() => {
    if (open) {
      setMembers(null);
      setInvites([]);
      setInviteTotal(0);
      setLastInvite(null);
      setIsOwner(false);
      setCanInvite(false);
      void loadMembers(1);
      void loadInvites(1);
    } else {
      memberRequest.current++;
      inviteRequest.current++;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copy this link", text);
    }
  };

  const invite = async () => {
    if (inviting || !workspaceId) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      toast.error("Enter a valid email address");
      return;
    }
    setInviting(true);
    try {
      const created = await createWorkspaceInvite({
        data: { workspaceId, email: address, role },
      });
      setLastInvite({
        email: address,
        link: inviteLink(created.token),
        emailed: Boolean(created.emailed),
      });
      setEmail("");
      void loadInvites(1);
    } catch (e: unknown) {
      if (!isBillingBlock(e)) {
        toast.error("Couldn't invite them", { description: errorMessage(e) });
      }
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (row: Invite) => {
    if (!workspaceId || pendingId) return;
    setPendingId(row.id);
    try {
      await revokeWorkspaceInvite({ data: { workspaceId, inviteId: row.id } });
      if (lastInvite?.email === row.email) setLastInvite(null);
      toast.success("Invite cancelled", { description: "That link no longer works." });
      void loadInvites(invites.length === 1 && invitePage > 1 ? invitePage - 1 : invitePage);
    } catch (e: unknown) {
      toast.error("Couldn't cancel the invite", { description: errorMessage(e) });
    } finally {
      setPendingId(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (!workspaceId || pendingId) return;
    setPendingId(member.user_id);
    try {
      await removeWorkspaceMember({ data: { workspaceId, userId: member.user_id } });
      toast.success(`${member.name ?? member.email ?? "Member"} removed`);
      void loadMembers(members?.length === 1 && memberPage > 1 ? memberPage - 1 : memberPage);
    } catch (e: unknown) {
      toast.error("Couldn't remove them", { description: errorMessage(e) });
    } finally {
      setPendingId(null);
    }
  };

  const changeRole = async (member: Member, next: Role) => {
    if (!workspaceId || pendingId) return;
    setPendingId(member.user_id);
    try {
      await updateWorkspaceMemberRole({
        data: { workspaceId, userId: member.user_id, role: next },
      });
      setMembers(
        (rows) =>
          rows?.map((m) => (m.user_id === member.user_id ? { ...m, role: next } : m)) ?? rows,
      );
      toast.success("Role updated");
    } catch (e: unknown) {
      if (!isBillingBlock(e)) {
        toast.error("Couldn't change the role", { description: errorMessage(e) });
      }
    } finally {
      setPendingId(null);
    }
  };

  const memberPages = Math.ceil(memberTotal / memberPageSize);
  const invitePages = Math.ceil(inviteTotal / INVITE_PAGE_SIZE);

  return (
    <>
      <Slot onClick={() => setOpen(true)}>{children}</Slot>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="sm"
        Icon={UserPlus}
        title="Invite your team"
        description="Work on this brand together"
        srDescription="Invite teammates and manage who has access"
        bodyClassName="px-5 py-5 sm:px-6"
      >
        <div className="space-y-6">
          {/* Invite */}
          <div className="space-y-2.5">
            <form
              className="flex flex-wrap items-stretch gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={!canInvite || inviting}
                aria-label="Teammate's email"
                autoComplete="off"
                className="h-10 min-w-[180px] flex-1"
              />
              <Select
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                disabled={!canInvite || inviting}
              >
                <SelectTrigger className="h-10 w-[112px]" aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                className="h-10"
                loading={inviting}
                disabled={!email.trim() || !canInvite}
              >
                Invite
              </Button>
            </form>
            <p className="text-[12px] text-muted-foreground">
              {members && !canInvite
                ? "Only admins and the owner can invite people."
                : `${role[0].toUpperCase()}${role.slice(1)}: ${ROLE_HINT[role].toLowerCase()}.`}
            </p>

            {lastInvite && (
              <div
                role="status"
                className="ds-well flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                  <Check className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 basis-[200px]">
                  <p className="truncate text-[13px] font-medium">
                    {lastInvite.emailed
                      ? `Invite emailed to ${lastInvite.email}`
                      : `Invite ready for ${lastInvite.email}`}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {lastInvite.emailed
                      ? "You can also send them the link yourself."
                      : "Send them this link. It only works for that email."}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={lastInvite.emailed ? "outline" : "default"}
                  onClick={() => copy(lastInvite.link, "last")}
                >
                  {copied === "last" ? "Copied" : "Copy link"}
                </Button>
              </div>
            )}
          </div>

          {/* People */}
          <div>
            <div className="ds-label mb-2">People{memberTotal > 0 ? ` · ${memberTotal}` : ""}</div>
            {membersError ? (
              <ErrorState
                size="sm"
                title="Couldn't load your team"
                onRetry={() => void loadMembers(memberPage)}
              />
            ) : !members ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-[var(--ds-radius-well)]" />
                ))}
              </div>
            ) : (
              <ul className="ds-tile divide-y divide-border/50 overflow-hidden">
                {members.map((m) => {
                  const editable = isOwner && !m.isYou && m.role !== "owner";
                  return (
                    <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
                      <Avatar className="size-8">
                        {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
                        <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-foreground">
                          {initials(m.name, m.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">
                          {m.name ?? m.email ?? "Member"}
                          {m.isYou && (
                            <span className="ml-1.5 font-normal text-muted-foreground">you</span>
                          )}
                        </p>
                        {m.email && m.name && (
                          <p className="truncate text-[12px] text-muted-foreground">{m.email}</p>
                        )}
                      </div>
                      {editable ? (
                        <>
                          <Select
                            value={m.role}
                            disabled={!!pendingId}
                            onValueChange={(v) => changeRole(m, v as Role)}
                          >
                            <SelectTrigger
                              className="h-8 w-[100px] text-[12px]"
                              aria-label={`Role for ${m.name ?? m.email ?? "member"}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="editor">Editor</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          <button
                            type="button"
                            onClick={() => removeMember(m)}
                            disabled={!!pendingId}
                            className={cn(dsIconBtn, "hover:text-destructive")}
                            title="Remove from workspace"
                            aria-label={`Remove ${m.name ?? m.email ?? "member"}`}
                          >
                            <X className="size-4" />
                          </button>
                        </>
                      ) : (
                        <span className="text-[12px] capitalize text-muted-foreground">
                          {m.role}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {memberPages > 1 && (
              <Pager
                page={memberPage}
                pages={memberPages}
                disabled={!!pendingId}
                onPage={(p) => void loadMembers(p)}
              />
            )}
          </div>

          {/* Waiting to join */}
          {inviteTotal > 0 && (
            <div>
              <div className="ds-label mb-2">Waiting to join · {inviteTotal}</div>
              <ul className="ds-tile divide-y divide-border/50 overflow-hidden">
                {invites.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground">
                      <Mail className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{row.email}</p>
                      <p className="text-[12px] capitalize text-muted-foreground">{row.role}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copy(inviteLink(row.token), row.id)}
                    >
                      <LinkIcon />
                      {copied === row.id ? "Copied" : "Copy link"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => cancelInvite(row)}
                      disabled={!!pendingId}
                      className={cn(dsIconBtn, "hover:text-destructive")}
                      title="Cancel invite"
                      aria-label={`Cancel invite for ${row.email}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              {invitePages > 1 && (
                <Pager
                  page={invitePage}
                  pages={invitePages}
                  disabled={!!pendingId}
                  onPage={(p) => void loadInvites(p)}
                />
              )}
            </div>
          )}
        </div>
      </AppModalShell>
    </>
  );
}

function Pager({
  page,
  pages,
  disabled,
  onPage,
}: {
  page: number;
  pages: number;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-2.5 flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite" className="tabular-nums">
        {page} of {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
