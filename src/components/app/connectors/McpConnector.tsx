"use client";

// Settings → AI assistants. Lets an admin allow Claude, ChatGPT and other
// assistants to work in this workspace, and shows what they did.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Check, Copy } from "@/components/icons";
import { GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { getMcpSettings, listMcpActivity, updateMcpSettings } from "@/lib/mcp.functions";

// Every key carries the workspace id, so a workspace switch drops them.
const keys = {
  all: (ws: string) => ["mcp", ws] as const,
  settings: (ws: string) => ["mcp", ws, "settings"] as const,
  activity: (ws: string) => ["mcp", ws, "activity"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const STEPS = [
  {
    name: "Claude",
    text: "Settings, Connectors, Add custom connector. Paste the address and sign in.",
  },
  {
    name: "ChatGPT",
    text: "Settings, Connectors, Create. Paste the address and sign in.",
  },
  { name: "Other apps", text: "Add a remote MCP server with this address." },
];

export function McpConnector({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: keys.settings(workspaceId),
    queryFn: () => getMcpSettings({ data: { workspaceId } }),
  });
  const canManage = settings.data?.canManage ?? false;
  const enabled = settings.data?.enabled ?? false;
  const activity = useQuery({
    queryKey: keys.activity(workspaceId),
    queryFn: () => listMcpActivity({ data: { workspaceId } }),
    enabled: canManage && enabled,
  });

  const save = useMutation({
    mutationFn: (next: { enabled: boolean; allowWrites: boolean }) =>
      updateMcpSettings({ data: { workspaceId, ...next } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all(workspaceId) }),
    onError: (error) => toast.error(message(error, "Couldn't save. Try again.")),
  });

  if (settings.isLoading) return <Skeleton className="h-40 w-full rounded-[20px]" />;
  if (settings.isError || !settings.data) {
    return (
      <ErrorState
        size="sm"
        title="AI assistants aren't available"
        detail={message(settings.error, "Try again in a moment.")}
        onRetry={() => settings.refetch()}
      />
    );
  }

  const { allowWrites, serverUrl, tools } = settings.data;
  const reads = tools.filter((t) => !t.write);
  const changes = tools.filter((t) => t.write);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it.");
    }
  };

  return (
    <div>
      <Tile className="p-0 sm:p-0">
        <ul className="divide-y divide-border/50">
          <Row
            label="Let AI assistants use this workspace"
            description="Claude, ChatGPT and others can read this workspace for people on your team."
            checked={enabled}
            disabled={!canManage || save.isPending}
            onChange={(v) => save.mutate({ enabled: v, allowWrites: v && allowWrites })}
          />
          <Row
            label="Let them make changes"
            description="Create and edit content, approve, schedule, post and run Autopilot. Uses your credits."
            checked={allowWrites}
            disabled={!canManage || !enabled || save.isPending}
            onChange={(v) => save.mutate({ enabled, allowWrites: v })}
          />
        </ul>
      </Tile>
      {!canManage && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Only an admin can change this.</p>
      )}

      {enabled && (
        <>
          <GroupLabel>Connect</GroupLabel>
          <Tile>
            <div className="flex items-center gap-2">
              <code className="ds-well min-w-0 flex-1 truncate px-3 py-2 text-[13px] text-foreground">
                {serverUrl}
              </code>
              <Button size="sm" onClick={copy}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
            <ul className="mt-4 space-y-2.5">
              {STEPS.map((step) => (
                <li key={step.name} className="text-[13px] text-muted-foreground">
                  <span className="font-medium text-foreground">{step.name}</span> · {step.text}
                </li>
              ))}
            </ul>
          </Tile>

          <GroupLabel>What an assistant can do</GroupLabel>
          <Tile>
            <p className="text-[13px] text-muted-foreground">
              Each person signs in as themselves and can only do what their role allows. Posts must
              be approved before they can be scheduled or posted.
            </p>
            <Abilities title="Read" items={reads.map((t) => t.title)} on />
            <Abilities title="Change" items={changes.map((t) => t.title)} on={allowWrites} />
          </Tile>

          {canManage && (
            <>
              <GroupLabel>Recent activity</GroupLabel>
              <Tile className="p-0 sm:p-0">
                {activity.isLoading ? (
                  <Skeleton className="m-4 h-16 rounded-[16px]" />
                ) : activity.data?.length ? (
                  <ul className="divide-y divide-border/50">
                    {activity.data.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] sm:px-5"
                      >
                        <span className="min-w-0 truncate text-foreground">{item.title}</span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {item.ok ? "" : "Didn't work · "}
                          {new Date(item.createdAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground sm:px-5">
                    Nothing yet.
                  </p>
                )}
              </Tile>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{label}</div>
        <p className="text-[12.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </li>
  );
}

function Abilities({ title, items, on }: { title: string; items: string[]; on: boolean }) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        {on && <Check className="h-3.5 w-3.5 text-primary" />}
        {title}
        {!on && <span className="font-normal text-muted-foreground">· off</span>}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        {items.join(" · ")}
      </p>
    </div>
  );
}
