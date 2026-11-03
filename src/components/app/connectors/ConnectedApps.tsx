"use client";

// Settings → Connections → Apps (ADR-0042): apps connected through Composio,
// drawn from the catalog (src/lib/integrations/catalog.ts). `AppsList` is
// presentational (rendered with sample data in /connections-lab);
// `ConnectedApps` loads the workspace's accounts and wires the buttons.
//
// Nothing is drawn until an app can really be connected here: apps whose
// workflow isn't built are `later` in the catalog and never shown.
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import {
  useOptionalWorkspaceId,
  useOptionalWorkspaceRole,
} from "@/components/workspace/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { emitAppEvent } from "@/lib/app-events";
import {
  connectableApps,
  integrationApp,
  type IntegrationApp,
  type IntegrationCategory,
} from "@/lib/integrations/catalog";
import { disconnectApp, getIntegrations, startAppConnect } from "@/lib/integrations.functions";
import { AppLogo } from "@/components/brand/AppLogo";
import { GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { ConnectionCard, ConnectionFact } from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { useConnectWindow } from "./useConnectWindow";

export type AppsView = Awaited<ReturnType<typeof getIntegrations>>;
type Account = AppsView["accounts"][number];

/** How apps are grouped when the list is grouped, in this order. */
const GROUPS: { label: string; categories: IntegrationCategory[] }[] = [
  { label: "Social", categories: ["social", "community"] },
  { label: "Design", categories: ["design"] },
  { label: "Email and customers", categories: ["email", "crm"] },
  { label: "Ads", categories: ["ads"] },
  { label: "Files and sheets", categories: ["productivity", "commerce"] },
  { label: "Team", categories: ["team"] },
];

export function AppsList({
  view,
  canEdit,
  busy,
  onConnect,
  onReconnect,
  onDisconnect,
  exclude = [],
  grouped = false,
}: {
  view: AppsView;
  canEdit: boolean;
  /** The app id or account id being worked on. */
  busy: string | null;
  onConnect: (app: IntegrationApp) => void;
  onReconnect: (account: Account) => void;
  onDisconnect: (account: Account) => void;
  /** Categories shown elsewhere (social accounts have their own list). */
  exclude?: IntegrationCategory[];
  /** Under a heading per kind of app. */
  grouped?: boolean;
}) {
  const shown = connectableApps({ testing: view.testing });
  // An account stays visible (to reconnect or disconnect) even if its app
  // stopped being connectable.
  for (const account of view.accounts) {
    const app = integrationApp(account.app);
    if (app && !shown.includes(app)) shown.push(app);
  }
  const apps = shown.filter((app) => !exclude.includes(app.category));
  if (!view.enabled || apps.length === 0) return null;
  if (grouped) {
    return (
      <div className="space-y-6">
        {GROUPS.map((group) => {
          const inGroup = apps.filter((app) => group.categories.includes(app.category));
          if (!inGroup.length) return null;
          return (
            <div key={group.label}>
              <GroupLabel>{group.label}</GroupLabel>
              {cards(inGroup)}
            </div>
          );
        })}
      </div>
    );
  }
  return cards(apps);

  function cards(list: IntegrationApp[]) {
    return (
      <div className="@container">
        <div className="grid gap-3 @2xl:grid-cols-2">{list.map((app) => card(app))}</div>
      </div>
    );
  }

  function card(app: IntegrationApp) {
    const accounts = view.accounts.filter((a) => a.app === app.id);
    const attention = accounts.filter((a) => a.status !== "active");
    const canAdd = canEdit && view.configured && (accounts.length === 0 || app.multiple);
    return (
      <ConnectionCard
        key={app.id}
        label={`${app.name} connection`}
        logo={<AppLogo app={app.id} name={app.name} size={28} />}
        name={app.name}
        description={app.does.join(" · ")}
        status={
          attention.length
            ? { tone: "attention", text: "Reconnect needed" }
            : accounts.length
              ? { tone: "connected", text: "Connected" }
              : { tone: "off", text: "Not connected" }
        }
        facts={
          accounts.length > 0 && (
            <>
              {accounts.map((account) => (
                <span key={account.id} className="inline-flex items-center gap-1">
                  <ConnectionFact tone={account.status === "active" ? "default" : "warning"}>
                    {account.label}
                  </ConnectionFact>
                  {canEdit && account.status !== "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => onReconnect(account)}
                    >
                      Reconnect
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => onDisconnect(account)}
                    >
                      Disconnect
                    </Button>
                  )}
                </span>
              ))}
            </>
          )
        }
        actions={
          canAdd && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => onConnect(app)}
            >
              {busy === app.id ? "Opening…" : accounts.length ? "Add another" : "Connect"}
            </Button>
          )
        }
        note={
          !view.configured
            ? "Connected apps aren't set up on this server yet."
            : (attention[0]?.problem ?? app.note)
        }
      />
    );
  }
}

export function ConnectedApps({
  exclude,
  grouped,
}: {
  exclude?: IntegrationCategory[];
  grouped?: boolean;
} = {}) {
  const workspaceId = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const [view, setView] = useState<AppsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setView(await getIntegrations({ data: { workspaceId } }));
    } catch {
      // Off for this workspace (404) or unreachable: show nothing, as before.
      setView(null);
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const appWindow = useConnectWindow("apps", workspaceId, (result) => {
    if (result?.status === "connected") {
      toast.success(result.accounts?.[0] ? `Connected ${result.accounts[0]}` : "Connected");
      emitAppEvent("connections:changed");
    } else if (result?.status === "error") {
      toast.error("That connection didn't finish. Try again.");
    }
    setBusy(null);
    void refresh();
  });

  if (!workspaceId || !view) return null;
  const canEdit = role === "owner" || role === "admin";

  const open = async (app: IntegrationApp, replaces?: string) => {
    setBusy(replaces ?? app.id);
    try {
      await appWindow.connect(
        async () =>
          (
            await startAppConnect({
              data: {
                workspaceId,
                app: app.id,
                replaces,
                returnOrigin: window.location.origin,
                // Back to where the person pressed Connect (Channels or Settings).
                returnPath: `${window.location.pathname}${window.location.search}`,
              },
            })
          ).url,
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : `Couldn't open ${app.name}.`);
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!leaving) return;
    setBusy(leaving.id);
    try {
      await disconnectApp({ data: { workspaceId, accountId: leaving.id } });
      toast.success(`${leaving.label} disconnected`);
      emitAppEvent("connections:changed");
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Couldn't disconnect.");
    } finally {
      setBusy(null);
      setLeaving(null);
    }
  };

  const leavingApp = leaving ? integrationApp(leaving.app) : null;
  return (
    <>
      <AppsList
        view={view}
        canEdit={canEdit}
        busy={busy}
        onConnect={(app) => void open(app)}
        onReconnect={(account) => {
          const app = integrationApp(account.app);
          if (app) void open(app, account.id);
        }}
        onDisconnect={setLeaving}
        exclude={exclude}
        grouped={grouped}
      />
      <DisconnectDialog
        open={leaving !== null}
        onOpenChange={(next) => !next && setLeaving(null)}
        name={leaving?.label ?? leavingApp?.name ?? "this app"}
        description={`Mellox stops using it for this brand. To remove Mellox's access completely, also remove it in your ${leavingApp?.name ?? "app"} settings.`}
        busy={busy !== null}
        onConfirm={() => void disconnect()}
      />
    </>
  );
}
