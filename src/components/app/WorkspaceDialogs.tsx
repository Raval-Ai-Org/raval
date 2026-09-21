"use client";

import { DeleteWorkspaceDialog } from "@/components/workspace/DeleteWorkspaceDialog";
import { addAppEventListener, removeAppEventListener, type AppEvent } from "@/lib/app-events";
import { useEffect, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { renameWorkspace, getWorkspaceDetails } from "@/lib/workspaces.functions";
import { Globe, Pencil, Info, Settings2 } from "@/components/ui/gemini-icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";
import { GitHubConnector } from "@/components/app/connectors/GitHubConnector";
import { WebflowConnector } from "@/components/app/connectors/WebflowConnector";
import { GoogleConnectCard } from "@/components/app/analytics/GoogleConnectCard";
import { CONNECTOR_PROVIDERS } from "@/lib/connectors/types";

type SettingsSection = "connections" | "preferences";

type Props = {
  workspaceId: string | null;
  workspaceName: string;
  onRenamed?: (name: string) => void;
};

export function WorkspaceDialogs({ workspaceId, workspaceName, onRenamed }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("connections");

  useEffect(() => {
    const openRename = () => setRenameOpen(true);
    const openDetails = () => setDetailsOpen(true);
    const openSettings = (e: AppEvent<"open:settings">) => {
      setSettingsSection(e.detail?.section ?? "connections");
      setSettingsOpen(true);
    };
    addAppEventListener("open:rename", openRename);
    addAppEventListener("open:details", openDetails);
    addAppEventListener("open:settings", openSettings);
    // Deep link: /app?settings=connections (the GitHub install returns here).
    const url = new URL(window.location.href);
    const section = url.searchParams.get("settings");
    if (section === "connections" || section === "preferences") {
      setSettingsSection(section);
      setSettingsOpen(true);
      url.searchParams.delete("settings");
      url.searchParams.delete("github");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return () => {
      removeAppEventListener("open:rename", openRename);
      removeAppEventListener("open:details", openDetails);
      removeAppEventListener("open:settings", openSettings);
    };
  }, []);

  return (
    <>
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        workspaceId={workspaceId}
        currentName={workspaceName}
        onRenamed={onRenamed}
      />
      <DetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} workspaceId={workspaceId} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        workspaceId={workspaceId}
        section={settingsSection}
        onSectionChange={setSettingsSection}
      />
    </>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  workspaceId,
  currentName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string | null;
  currentName: string;
  onRenamed?: (name: string) => void;
}) {
  const rename = useServerFn(renameWorkspace);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await rename({ data: { workspaceId, name: trimmed } });
      try {
        localStorage.setItem("workspace:name", trimmed);
      } catch {}
      onRenamed?.(trimmed);
      toast.success("Workspace renamed");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't rename workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      Icon={Pencil}
      eyebrow="Workspace"
      title="Rename workspace"
      description="This is how the workspace shows up across Mellox AI."
      bodyClassName="px-5 py-5 sm:px-6"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Name
          </label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            maxLength={120}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !workspaceId}>
            Save changes
          </Button>
        </div>
      </form>
    </AppModalShell>
  );
}

function DetailsDialog({
  open,
  onOpenChange,
  workspaceId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string | null;
}) {
  const fetchDetails = useServerFn(getWorkspaceDetails);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getWorkspaceDetails>> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    fetchDetails({ data: { workspaceId } })
      .then((d) => setDetails(d))
      .catch(() => toast.error("Couldn't load workspace details"))
      .finally(() => setLoading(false));
  }, [open, workspaceId, fetchDetails]);

  const rows: Array<[string, React.ReactNode]> = details
    ? [
        ["Name", <span className="font-medium">{details.name}</span>],
        [
          "Plan",
          <span className="inline-flex items-center rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium capitalize">
            {details.plan}
          </span>,
        ],
        ["Members", <span className="font-medium tabular-nums">{details.memberCount}</span>],
        ["Your role", <span className="font-medium capitalize">{details.role}</span>],
        ...(details.websiteUrl
          ? [
              ["Website", <span className="truncate font-medium">{details.websiteUrl}</span>] as [
                string,
                React.ReactNode,
              ],
            ]
          : []),
        ...(details.industry
          ? [
              ["Industry", <span className="font-medium">{details.industry}</span>] as [
                string,
                React.ReactNode,
              ],
            ]
          : []),
        [
          "Created",
          <span className="font-medium">{new Date(details.createdAt).toLocaleDateString()}</span>,
        ],
      ]
    : [];

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      Icon={Info}
      eyebrow="Workspace"
      title="Workspace details"
      description="Quick facts about this workspace."
      bodyClassName="px-5 py-5 sm:px-6"
    >
      {loading || !details ? (
        <ul className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-32" />
            </li>
          ))}
        </ul>
      ) : (
        <dl className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-[13px]"
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        {details?.isOwner ? (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleting(true)}
          >
            Delete workspace…
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
      <DeleteWorkspaceDialog
        workspace={
          deleting && details
            ? {
                id: details.id,
                name: details.name,
                domain: details.domain,
                websiteUrl: details.websiteUrl,
              }
            : null
        }
        onOpenChange={(v) => {
          if (!v) setDeleting(false);
        }}
        onDeleted={() => onOpenChange(false)}
      />
    </AppModalShell>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  workspaceId,
  section,
  onSectionChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string | null;
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
}) {
  const [notifications, setNotifications] = useState(true);
  const [sounds, setSounds] = useState(true);

  useEffect(() => {
    if (!open) return;
    try {
      setNotifications(localStorage.getItem("settings:notifications") !== "0");
      setSounds(localStorage.getItem("settings:sounds") !== "0");
    } catch {}
  }, [open]);

  const save = (key: string, value: boolean) => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {}
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      Icon={Settings2}
      eyebrow="Workspace"
      title="Settings"
      description="Connect the accounts and systems Mellox works with, and tune how it behaves on this device."
      bodyClassName="space-y-5 px-5 py-5 sm:px-6"
    >
      <Tabs value={section} onValueChange={(v) => onSectionChange(v as SettingsSection)}>
        <TabsList className="h-9 rounded-full bg-muted/70 p-1">
          <TabsTrigger value="connections" className="rounded-full px-3 text-[12.5px]">
            Connections
          </TabsTrigger>
          <TabsTrigger value="preferences" className="rounded-full px-3 text-[12.5px]">
            Preferences
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="mt-5 space-y-6">
          <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-card/80 via-card/45 to-primary/[0.04] px-4 py-4 sm:px-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
              Integrations
            </p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">
              Connect the tools your marketing intelligence works with.
            </h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              Connect a website source, codebase, or analytics account. Mellox only shows resources
              that the connected account can actually access.
            </p>
          </div>
          <SocialAccountsSection variant="settings" />
          {workspaceId && (
            <div className="border-t border-border/70 pt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Analytics
              </p>
              <GoogleConnectCard />
            </div>
          )}
          <div className="border-t border-border/70 pt-5">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Development &amp; Website
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Connect the live site and the code that powers it. These are independent sources;
                use either one or both.
              </p>
            </div>
            {workspaceId ? (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <GitHubConnector workspaceId={workspaceId} />
                <WebflowConnector workspaceId={workspaceId} />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Select a workspace to manage connections.
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="preferences" className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Device preferences
          </p>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40">
            <ToggleRow
              label="Approval notifications"
              description="Toast me when an agent needs a sign-off."
              checked={notifications}
              onChange={(v) => {
                setNotifications(v);
                save("settings:notifications", v);
              }}
            />
            <ToggleRow
              label="Interface sounds"
              description="Subtle chimes when actions complete."
              checked={sounds}
              onChange={(v) => {
                setSounds(v);
                save("settings:sounds", v);
              }}
            />
          </ul>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Need theme controls? Open the workspace menu → Appearance.
          </p>
        </TabsContent>
      </Tabs>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </div>
    </AppModalShell>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <p className="text-[11.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </li>
  );
}
