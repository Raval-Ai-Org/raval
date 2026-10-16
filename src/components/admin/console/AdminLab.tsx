"use client";

// AdminLab — development-only visual QA for the admin console (/admin-lab).
// It renders the REAL screens inside the REAL shell, with /api/admin/* answered
// by sample data in the browser, so no sign-in, database or admin account is
// needed. The role switch (?role=support) shows how the same screens look for
// each role, including the "your role can't do that" answers.
//
//   /admin-lab?s=overview|users|user|workspaces|workspace|audit|security|team|plans
//   /admin-lab?s=workspace&role=analyst

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  hasPermission,
  isAdminRoleKey,
  type AdminRoleKey,
  type Permission,
} from "@/lib/admin/permissions";
import { AdminShell } from "./AdminShell";
import {
  LAB_OVERVIEW,
  labAudit,
  labEntitlements,
  labMe,
  labSecurity,
  labTeam,
  labUserDetail,
  labUsers,
  labWorkspaceDetail,
  labWorkspaces,
} from "./AdminLab.fixtures";
import { AuditScreen } from "./AuditScreen";
import { OverviewScreen } from "./OverviewScreen";
import { PlansScreen } from "./PlansScreen";
import { SecurityScreen } from "./SecurityScreen";
import { TeamScreen } from "./TeamScreen";
import { UserDetailScreen } from "./UserDetailScreen";
import { UsersScreen } from "./UsersScreen";
import { WorkspaceDetailScreen } from "./WorkspaceDetailScreen";
import { WorkspacesScreen } from "./WorkspacesScreen";

const USER_ID = "10000001-0000-4000-8000-000000000001";
const WORKSPACE_ID = "20000001-0000-4000-8000-000000000001";

/** The permission each sample route needs, mirroring the real routes. */
const NEEDS: Record<string, Permission | "any"> = {
  "/api/admin/me": "any",
  "/api/admin/overview": "overview.read",
  "/api/admin/users": "users.read",
  "/api/admin/users/detail": "users.read",
  "/api/admin/users/suspend": "users.suspend",
  "/api/admin/users/sessions": "users.sessions.revoke",
  "/api/admin/users/notes": "users.notes.write",
  "/api/admin/workspaces": "workspaces.read",
  "/api/admin/workspaces/detail": "workspaces.read",
  "/api/admin/entitlements": "entitlements.read",
  "/api/admin/entitlements/overrides": "entitlements.override",
  "/api/admin/entitlements/overrides/revoke": "entitlements.override",
  "/api/admin/audit": "audit.read",
  "/api/admin/security": "security.read",
  "/api/admin/team": "admins.read",
};

function install(role: AdminRoleKey): () => void {
  const original = window.fetch.bind(window);
  const me = labMe(role);
  const pii = hasPermission(me.permissions, "users.pii.read");

  window.fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (!url.pathname.startsWith("/api/admin/")) return original(input, init);

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    const needs = NEEDS[url.pathname];
    if (!needs) return json({ error: "Not found" }, 404);
    if (needs !== "any" && !hasPermission(me.permissions, needs)) {
      return json({ error: "Your admin role can't do that.", code: "forbidden" }, 403);
    }
    const post = (init?.method ?? "GET").toUpperCase() === "POST";
    await new Promise((resolve) => setTimeout(resolve, 120));

    switch (url.pathname) {
      case "/api/admin/me":
        return json(me);
      case "/api/admin/overview":
        return json(LAB_OVERVIEW);
      case "/api/admin/users":
        return json(labUsers(pii));
      case "/api/admin/users/detail":
        return json(labUserDetail(pii));
      case "/api/admin/workspaces":
        return json(labWorkspaces(pii));
      case "/api/admin/workspaces/detail":
        return json(labWorkspaceDetail(pii));
      case "/api/admin/entitlements":
        return json(labEntitlements(pii));
      case "/api/admin/audit":
        return json(labAudit(pii));
      case "/api/admin/security":
        return json(labSecurity(pii));
      case "/api/admin/team":
        return post ? json({ ok: true, userId: USER_ID }) : json(labTeam(pii));
      default:
        // Every other route here is a change: pretend it worked.
        return json({ ok: true, id: "lab", suspended: true, sessionsEnded: 2 });
    }
  };
  return () => {
    window.fetch = original;
  };
}

export function AdminLab() {
  const params = useSearchParams();
  const section = params.get("s") ?? "overview";
  const roleParam = params.get("role");
  const role: AdminRoleKey = isAdminRoleKey(roleParam) ? roleParam : "super_admin";
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    queryClient.clear();
    const restore = install(role);
    setReady(true);
    return () => {
      restore();
      setReady(false);
    };
  }, [role, queryClient]);

  let screen;
  switch (section) {
    case "users":
      screen = <UsersScreen />;
      break;
    case "user":
      screen = <UserDetailScreen id={USER_ID} />;
      break;
    case "workspaces":
      screen = <WorkspacesScreen />;
      break;
    case "workspace":
      screen = <WorkspaceDetailScreen id={WORKSPACE_ID} />;
      break;
    case "audit":
      screen = <AuditScreen />;
      break;
    case "security":
      screen = <SecurityScreen />;
      break;
    case "team":
      screen = <TeamScreen />;
      break;
    case "plans":
      screen = <PlansScreen />;
      break;
    default:
      screen = <OverviewScreen />;
  }

  return (
    <div data-testid="admin-lab-frame" data-ready={ready ? "true" : "false"} data-role={role}>
      {ready ? <AdminShell key={`${role}-${section}`}>{screen}</AdminShell> : null}
    </div>
  );
}
