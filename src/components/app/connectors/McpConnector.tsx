"use client";

// Settings → AI assistants. Lets an admin allow Claude, ChatGPT and other
// assistants to work in this workspace, and shows what they did.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Bot, Check, Copy } from "@/components/icons";
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

const ASSISTANTS = [
  {
    name: "Claude",
    logo: "claude",
    steps:
      "Open Customize → Connectors → Add custom connector. Name it Mellox AI, paste the Mellox server address, and sign in.",
    help: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  {
    name: "ChatGPT",
    logo: "chatgpt",
    steps:
      "Open Settings → Apps → Create. Name the app Mellox AI, paste the Mellox server address, scan its tools, and sign in.",
    help: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt",
  },
  {
    name: "Other MCP apps",
    logo: "other",
    steps:
      "Add a remote MCP server in your app. Use Mellox AI as its name, paste the Mellox server address, and sign in.",
    help: null,
  },
] as const;

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

      <GroupLabel>Connect an assistant</GroupLabel>
      <Tile>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Connect Claude, ChatGPT, or another MCP app to Mellox. Use{" "}
          <strong className="font-medium text-foreground">Mellox AI</strong> as the connection name.
          The same server address works in every app.
        </p>
        {enabled ? (
          <>
            <p className="mb-2 mt-4 text-[13px] font-medium text-foreground">
              Mellox server address
            </p>
            <div className="flex items-center gap-2">
              <code className="ds-well min-w-0 flex-1 truncate px-3 py-2 text-[13px] text-foreground">
                {serverUrl}
              </code>
              <Button size="sm" onClick={copy}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            </div>
          </>
        ) : (
          <p className="ds-well mt-4 rounded-xl px-3 py-3 text-[13px] text-muted-foreground">
            Turn on “Let AI assistants use this workspace” above to see the server address. Access
            is off until then.
          </p>
        )}
        <ul className="mt-4 divide-y divide-border/50 border-t border-border/50">
          {ASSISTANTS.map((assistant) => (
            <li key={assistant.name} className="flex gap-3 py-4 last:pb-0">
              <AssistantLogo kind={assistant.logo} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-foreground">{assistant.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {assistant.steps}
                </p>
                {assistant.help && (
                  <a
                    href={assistant.help}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-[12.5px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Setup help
                    <span className="sr-only"> for {assistant.name} (opens in a new tab)</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Each teammate signs in with their own Mellox account. Their workspace role and the two
          switches above decide what the assistant can do.
        </p>
      </Tile>

      {enabled && (
        <>
          <GroupLabel>What an assistant can do</GroupLabel>
          <Tile>
            <p className="text-[13px] text-muted-foreground">
              Your Mellox role still applies. Posts must be approved before they can be scheduled or
              published.
            </p>
            <Abilities
              title="Read workspace information"
              summary="See content, calendars, analytics, brand details and AI visibility."
              items={reads.map((t) => t.title)}
              on
            />
            <Abilities
              title="Make changes"
              summary="Create and edit content, manage schedules and Autopilot, and use credits when a tool needs them."
              items={changes.map((t) => t.title)}
              on={allowWrites}
            />
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

function AssistantLogo({ kind }: { kind: (typeof ASSISTANTS)[number]["logo"] }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-[var(--ds-well-bg)]"
      aria-hidden
    >
      {kind === "claude" ? (
        <Image src="/assets/assistant-connectors/claude.svg" alt="" width={32} height={32} />
      ) : kind === "chatgpt" ? (
        <>
          <Image
            src="/assets/assistant-connectors/openai-blossom-black.svg"
            alt=""
            width={32}
            height={32}
            className="dark:hidden"
          />
          <Image
            src="/assets/assistant-connectors/openai-blossom-white.svg"
            alt=""
            width={32}
            height={32}
            className="hidden dark:block"
          />
        </>
      ) : (
        <Bot className="h-5 w-5 text-muted-foreground" />
      )}
    </span>
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

function Abilities({
  title,
  summary,
  items,
  on,
}: {
  title: string;
  summary: string;
  items: string[];
  on: boolean;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        {on && <Check className="h-3.5 w-3.5 text-primary" />}
        {title}
        {!on && <span className="font-normal text-muted-foreground">· off</span>}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{summary}</p>
      <details className="mt-1.5 text-[12.5px] text-muted-foreground">
        <summary className="w-fit cursor-pointer text-primary">See all tools</summary>
        <p className="mt-2 leading-relaxed">{items.join(" · ")}</p>
      </details>
    </div>
  );
}
