import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { renameWorkspace, getWorkspaceDetails } from "@/lib/workspaces.functions";
import { Github, Globe, Plug, Pencil, Info, Settings2 } from "@/components/ui/gemini-icons";
import { BrandLogo } from "@/components/brand/BrandLogo";

type Props = {
  workspaceId: string | null;
  workspaceName: string;
  onRenamed?: (name: string) => void;
};

export function WorkspaceDialogs({ workspaceId, workspaceName, onRenamed }: Props) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);

  useEffect(() => {
    const openRename = () => setRenameOpen(true);
    const openDetails = () => setDetailsOpen(true);
    const openSettings = () => setSettingsOpen(true);
    const openConnectors = () => setConnectorsOpen(true);
    window.addEventListener("open:rename", openRename);
    window.addEventListener("open:details", openDetails);
    window.addEventListener("open:settings", openSettings);
    window.addEventListener("open:connectors", openConnectors);
    return () => {
      window.removeEventListener("open:rename", openRename);
      window.removeEventListener("open:details", openDetails);
      window.removeEventListener("open:settings", openSettings);
      window.removeEventListener("open:connectors", openConnectors);
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConnectorsDialog open={connectorsOpen} onOpenChange={setConnectorsOpen} />
    </>
  );
}

function RenameDialog({
  open, onOpenChange, workspaceId, currentName, onRenamed,
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

  useEffect(() => { if (open) setName(currentName); }, [open, currentName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) { onOpenChange(false); return; }
    setSaving(true);
    try {
      await rename({ data: { workspaceId, name: trimmed } });
      try { localStorage.setItem("workspace:name", trimmed); } catch {}
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
      description="This is how the workspace shows up across Raval AI."
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !workspaceId}>
            Save changes
          </Button>
        </div>
      </form>
    </AppModalShell>
  );
}

function DetailsDialog({
  open, onOpenChange, workspaceId,
}: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string | null }) {
  const fetchDetails = useServerFn(getWorkspaceDetails);
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getWorkspaceDetails>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    fetchDetails({ data: { workspaceId } })
      .then((d) => setDetails(d))
      .catch(() => toast.error("Couldn't load workspace details"))
      .finally(() => setLoading(false));
  }, [open, workspaceId, fetchDetails]);

  const rows: Array<[string, React.ReactNode]> = details ? [
    ["Name", <span className="font-medium">{details.name}</span>],
    ["Plan", <span className="inline-flex items-center rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 text-[11px] font-medium capitalize">{details.plan}</span>],
    ["Members", <span className="font-medium tabular-nums">{details.memberCount}</span>],
    ["Your role", <span className="font-medium">{details.isOwner ? "Owner" : "Member"}</span>],
    ...(details.websiteUrl ? [["Website", <span className="truncate font-medium">{details.websiteUrl}</span>] as [string, React.ReactNode] ] : []),
    ...(details.industry ? [["Industry", <span className="font-medium">{details.industry}</span>] as [string, React.ReactNode] ] : []),
    ["Created", <span className="font-medium">{new Date(details.createdAt).toLocaleDateString()}</span>],
  ] : [];

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
            <div key={k} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-[13px]">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
      </div>
    </AppModalShell>
  );
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
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
    try { localStorage.setItem(key, value ? "1" : "0"); } catch {}
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      Icon={Settings2}
      eyebrow="Preferences"
      title="Settings"
      description="Tune how Raval AI behaves on this device."
      bodyClassName="px-5 py-5 sm:px-6"
    >
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card/40">
        <ToggleRow
          label="Approval notifications"
          description="Toast me when an agent needs a sign-off."
          checked={notifications}
          onChange={(v) => { setNotifications(v); save("settings:notifications", v); }}
        />
        <ToggleRow
          label="Interface sounds"
          description="Subtle chimes when actions complete."
          checked={sounds}
          onChange={(v) => { setSounds(v); save("settings:sounds", v); }}
        />
      </ul>
      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Need theme controls? Open the workspace menu → Appearance.
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => onOpenChange(false)}>Done</Button>
      </div>
    </AppModalShell>
  );
}

function ToggleRow({
  label, description, checked, onChange,
}: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
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

function ConnectorsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const connectors = [
    { id: "meta", label: "Meta Ads", desc: "Facebook & Instagram campaigns", icon: <BrandLogo name="meta" brand size={18} /> },
    { id: "google", label: "Google Ads", desc: "Search, YouTube & Performance Max", icon: <BrandLogo name="google" brand size={18} /> },
    { id: "github", label: "GitHub", desc: "Read repos, ship pull requests", icon: <Github className="h-4 w-4" /> },
    { id: "wordpress", label: "WordPress", desc: "Publish posts and pages", icon: <Globe className="h-4 w-4" /> },
  ];
  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      Icon={Plug}
      eyebrow="Integrations"
      title="Connectors"
      description="Plug Raval AI into the tools your team already uses."
      bodyClassName="px-5 py-5 sm:px-6"
    >
      <ul className="space-y-2">
        {connectors.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 transition hover:border-border">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">{c.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{c.label}</div>
              <p className="truncate text-[11.5px] text-muted-foreground">{c.desc}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.success(`We'll notify you when ${c.label} is live`)}
            >
              Notify me
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
      </div>
    </AppModalShell>
  );
}
