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
import { BarChart, Monitor, Moon, SlidersHorizontal, Sun, Users } from "@/components/icons";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import {
  GroupLabel,
  SurfaceLayout,
  SurfacePage,
  Tile,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";
import { GitHubConnector } from "@/components/app/connectors/GitHubConnector";
import { WebflowConnector } from "@/components/app/connectors/WebflowConnector";
import { WordPressConnector } from "@/components/app/connectors/WordPressConnector";
import { GoogleConnectCard } from "@/components/app/analytics/GoogleConnectCard";

type SettingsSection = "accounts" | "analytics" | "website" | "preferences";

/** The GitHub install returns to ?settings=connections, which means the website sources. */
function sectionFromUrl(value: string | null): SettingsSection | null {
  if (value === "connections") return "website";
  return value === "accounts" ||
    value === "analytics" ||
    value === "website" ||
    value === "preferences"
    ? value
    : null;
}

type Props = {
  workspaceId: string | null;
  workspaceName: string;
  onRenamed?: (name: string) => void;
};

export function WorkspaceDialogs({ workspaceId, workspaceName, onRenamed }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("accounts");

  useEffect(() => {
    const openRename = () => setRenameOpen(true);
    const openDetails = () => setDetailsOpen(true);
    const openSettings = (e: AppEvent<"open:settings">) => {
      setSettingsSection(e.detail?.section ?? "accounts");
      setSettingsOpen(true);
    };
    addAppEventListener("open:rename", openRename);
    addAppEventListener("open:details", openDetails);
    addAppEventListener("open:settings", openSettings);
    // Deep link: /app?settings=connections (the GitHub install returns here).
    const url = new URL(window.location.href);
    const section = sectionFromUrl(url.searchParams.get("settings"));
    if (section) {
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

const SETTINGS_NAV: SurfaceNavItem<SettingsSection>[] = [
  { id: "accounts", label: "Social accounts", icon: Users },
  { id: "analytics", label: "Analytics", icon: BarChart },
  { id: "website", label: "Website", icon: Globe },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

const THEMES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

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
  const { preference, setPreference } = useTheme();

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

  const noWorkspace = (
    <p className="text-[13px] text-muted-foreground">Open a workspace to manage connections.</p>
  );

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      Icon={Settings2}
      title="Settings"
      srDescription="Connected accounts, analytics, website sources and device preferences"
      bodyClassName="overflow-hidden"
    >
      <SurfaceLayout
        label="Settings"
        items={SETTINGS_NAV}
        value={section}
        onChange={onSectionChange}
      >
        <div key={section} className="animate-in fade-in duration-300">
          {section === "accounts" && (
            <SurfacePage width="narrow">
              <SocialAccountsSection variant="settings" />
            </SurfacePage>
          )}
          {section === "analytics" && (
            <SurfacePage title="Analytics" width="narrow">
              {workspaceId ? <GoogleConnectCard /> : noWorkspace}
            </SurfacePage>
          )}
          {section === "website" && (
            <SurfacePage
              title="Website"
              subtitle="Your live site and the code behind it"
              width="narrow"
            >
              {workspaceId ? (
                <div className="space-y-3">
                  <Tile>
                    <GitHubConnector workspaceId={workspaceId} />
                  </Tile>
                  <WebflowConnector workspaceId={workspaceId} />
                  <WordPressConnector workspaceId={workspaceId} />
                </div>
              ) : (
                noWorkspace
              )}
            </SurfacePage>
          )}
          {section === "preferences" && (
            <SurfacePage title="Preferences" width="narrow">
              <GroupLabel>Theme</GroupLabel>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
                {THEMES.map((t) => {
                  const selected = preference === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPreference(t.id)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-[20px] border px-3 py-4 text-[13px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        selected
                          ? "border-primary/50 bg-primary/[0.08] text-foreground"
                          : "border-border/50 bg-surface-3 text-muted-foreground hover:text-foreground dark:border-white/[0.06] dark:bg-white/[0.035]",
                      )}
                    >
                      <Icon className={cn("h-5 w-5", selected && "text-primary")} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <GroupLabel>On this device</GroupLabel>
              <Tile className="p-0 sm:p-0">
                <ul className="divide-y divide-border/50">
                  <ToggleRow
                    label="Approval alerts"
                    description="When an agent needs your OK"
                    checked={notifications}
                    onChange={(v) => {
                      setNotifications(v);
                      save("settings:notifications", v);
                    }}
                  />
                  <ToggleRow
                    label="Sounds"
                    description="A soft chime when something finishes"
                    checked={sounds}
                    onChange={(v) => {
                      setSounds(v);
                      save("settings:sounds", v);
                    }}
                  />
                </ul>
              </Tile>
            </SurfacePage>
          )}
        </div>
      </SurfaceLayout>
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
    <li className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{label}</div>
        <p className="text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </li>
  );
}
