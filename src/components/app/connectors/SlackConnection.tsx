"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { cn } from "@/lib/utils";
import {
  getSlackConnection,
  startSlackConnect,
  listSlackChannels,
  setSlackChannel,
  setSlackPreferences,
  createSlackLinkCode,
  sendSlackTest,
  disconnectSlack,
} from "@/lib/slack.functions";

type State = Awaited<ReturnType<typeof getSlackConnection>>;
type Purpose = "approvals" | "marketing" | "intelligence";
const mapping: { purpose: Purpose; title: string; description: string }[] = [
  { purpose: "approvals", title: "Approvals", description: "Posts that need a decision" },
  { purpose: "marketing", title: "Marketing", description: "Daily brief and publishing issues" },
  {
    purpose: "intelligence",
    title: "Intelligence",
    description: "Important market and performance changes",
  },
];
const preferences = [
  ["daily_brief", "Daily marketing brief", "A concise update at your chosen hour"],
  ["approvals", "Content approvals", "Review posts with Slack buttons"],
  ["publishing_failures", "Publishing failures", "Know when a post could not go live"],
  ["competitor_alerts", "Competitor moves", "Major changes only"],
  ["market_alerts", "Market opportunities", "High priority opportunities"],
  ["geo_alerts", "AI Visibility changes", "Meaningful score changes"],
  ["performance_alerts", "Performance anomalies", "Important negative signals"],
] as const;
type PrefKey = (typeof preferences)[number][0];
type Prefs = Record<PrefKey, boolean> & { brief_hour: number; brief_timezone: string };
const defaults: Prefs = {
  daily_brief: false,
  approvals: true,
  publishing_failures: true,
  competitor_alerts: false,
  market_alerts: false,
  geo_alerts: false,
  performance_alerts: false,
  brief_hour: 9,
  brief_timezone: "UTC",
};

function SlackMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 54 54" className="size-8 shrink-0">
      <path
        fill="#36C5F0"
        d="M19.7 3a4.7 4.7 0 1 0-9.4 0v12h9.4V3Zm0 16.7H7.7a4.7 4.7 0 0 0 0 9.4h12v-9.4Z"
      />
      <path
        fill="#2EB67D"
        d="M51 19.7a4.7 4.7 0 1 0 0-9.4H39v9.4h12Zm-16.7 0v-12a4.7 4.7 0 0 0-9.4 0v12h9.4Z"
      />
      <path
        fill="#ECB22E"
        d="M34.3 51a4.7 4.7 0 1 0 9.4 0V39h-9.4v12Zm0-16.7h12a4.7 4.7 0 0 0 0-9.4h-12v9.4Z"
      />
      <path
        fill="#E01E5A"
        d="M3 34.3a4.7 4.7 0 1 0 0 9.4h12v-9.4H3Zm16.7 0v12a4.7 4.7 0 0 0 9.4 0v-12h-9.4Z"
      />
    </svg>
  );
}

export function SlackConnection({ workspaceId }: { workspaceId: string }) {
  const role = useOptionalWorkspaceRole();
  const canManage = role === "owner" || role === "admin";
  const [state, setState] = useState<State | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState("");
  const refresh = useCallback(async () => {
    try {
      const data = await getSlackConnection({ data: { workspaceId } });
      setState(data);
      setPrefs({ ...defaults, ...(data.preferences ?? {}) });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Slack connection");
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("slack") === "connected") {
      toast.success("Slack connected");
      setExpanded(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("slack");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const run = async (label: string, work: () => Promise<unknown>, message?: string) => {
    setBusy(label);
    setError("");
    try {
      await work();
      if (message) toast.success(message);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Slack could not complete this action";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  };
  const connected = state?.connection?.status === "active";
  const mapped = (purpose: Purpose) =>
    state?.channels.find((c) => c.purpose === purpose)?.channel_id ?? "";
  const discover = () =>
    run("channels", async () => setChannels(await listSlackChannels({ data: { workspaceId } })));
  const changeChannel = (purpose: Purpose, channelId: string) =>
    run(
      `channel:${purpose}`,
      () => setSlackChannel({ data: { workspaceId, purpose, channelId: channelId || null } }),
      "Channel saved",
    );
  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    void run(
      "preferences",
      () => setSlackPreferences({ data: { workspaceId, preferences: next } }),
      "Slack preferences saved",
    );
  };
  return (
    <div className="overflow-hidden rounded-[24px] border border-border/60 bg-surface-2/70 shadow-sm dark:border-white/[0.08]">
      <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
        <div className="grid size-12 place-items-center rounded-2xl bg-background shadow-sm">
          <SlackMark />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16px] font-semibold text-foreground">Mellox for Slack</h3>
            {state && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                  connected
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : state.connection?.status === "reconnect_needed"
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {connected
                  ? "Connected"
                  : state.connection?.status === "reconnect_needed"
                    ? "Reconnect needed"
                    : "Not connected"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            {connected
              ? `${state?.connection?.teamName} · Your marketing work, where your team talks.`
              : "Review content, get a daily brief, and ask Mellox about your brand right from Slack."}
          </p>
          {connected && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {state?.connection?.connectedBy
                ? `Connected by ${state.connection.connectedBy} · `
                : ""}
              {state?.connection?.lastEventAt
                ? `Last activity ${new Date(state.connection.lastEventAt).toLocaleString()}`
                : "Waiting for first Slack interaction"}
            </p>
          )}
          {connected && state?.connection?.lastError && (
            <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
              Slack needs attention: {state.connection.lastError.replaceAll("_", " ")}
            </p>
          )}
        </div>
        {state?.enabled && (
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button
                size="sm"
                disabled={!canManage || !!busy || !state.configured}
                onClick={() =>
                  void run("connect", async () => {
                    const result = await startSlackConnect({ data: { workspaceId } });
                    window.location.assign(result.url);
                  })
                }
              >
                {state.connection ? "Reconnect" : "Connect Slack"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExpanded((v) => !v);
                  if (!expanded) void discover();
                }}
              >
                {expanded ? "Close settings" : "Configure"}
              </Button>
            )}
          </div>
        )}
      </div>
      {!state && !error && (
        <div className="space-y-2 px-6 pb-5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}
      {state && !state.enabled && (
        <p className="px-6 pb-5 text-[12px] text-muted-foreground">
          Slack is not enabled for this workspace yet.
        </p>
      )}
      {state?.enabled && !state.configured && (
        <p className="px-6 pb-5 text-[12px] text-amber-700 dark:text-amber-300">
          Slack needs server configuration before it can connect.
        </p>
      )}
      {error && (
        <p role="alert" className="px-6 pb-5 text-[12px] text-destructive">
          {error}
        </p>
      )}
      {connected && expanded && (
        <div className="space-y-6 border-t border-border/50 px-5 py-5 sm:px-6 dark:border-white/[0.08]">
          <div>
            <h4 className="text-[13px] font-semibold">Where Mellox posts</h4>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Choose a different channel for each purpose. Add Mellox to each channel in Slack
              first.
            </p>
            <div className="mt-3 space-y-2">
              {mapping.map((m) => (
                <div
                  key={m.purpose}
                  className="flex flex-col gap-2 rounded-2xl bg-background/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-[13px] font-medium">{m.title}</p>
                    <p className="text-[12px] text-muted-foreground">{m.description}</p>
                  </div>
                  <select
                    aria-label={`${m.title} channel`}
                    value={mapped(m.purpose)}
                    disabled={!canManage || !!busy}
                    onFocus={() => {
                      if (!channels.length) void discover();
                    }}
                    onChange={(e) => void changeChannel(m.purpose, e.target.value)}
                    className="min-h-9 min-w-[180px] rounded-xl border border-border bg-background px-3 text-[13px] text-foreground"
                  >
                    <option value="">No channel</option>
                    {mapped(m.purpose) && !channels.some((c) => c.id === mapped(m.purpose)) && (
                      <option value={mapped(m.purpose)}>
                        #{state?.channels.find((c) => c.purpose === m.purpose)?.channel_name}
                      </option>
                    )}
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => void discover()}
                disabled={!!busy}
                className="mt-2 text-[12px] font-medium text-primary hover:underline"
              >
                Refresh channels
              </button>
            )}
          </div>
          <div>
            <h4 className="text-[13px] font-semibold">Keep the team in the loop</h4>
            <div className="mt-2 divide-y divide-border/40">
              {preferences.map(([key, label, description]) => (
                <div key={key} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium">{label}</p>
                    <p className="text-[12px] text-muted-foreground">{description}</p>
                  </div>
                  <Switch
                    aria-label={label}
                    checked={prefs[key]}
                    disabled={!canManage || !!busy}
                    onCheckedChange={(value) => savePrefs({ ...prefs, [key]: value })}
                  />
                </div>
              ))}
            </div>
            {prefs.daily_brief && (
              <div className="flex flex-wrap items-center gap-2 pt-2 text-[12px]">
                <label htmlFor={`slack-hour-${workspaceId}`}>Send at</label>
                <select
                  id={`slack-hour-${workspaceId}`}
                  value={prefs.brief_hour}
                  disabled={!canManage || !!busy}
                  onChange={(e) => savePrefs({ ...prefs, brief_hour: Number(e.target.value) })}
                  className="rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <label htmlFor={`slack-zone-${workspaceId}`}>Time zone</label>
                <input
                  id={`slack-zone-${workspaceId}`}
                  value={prefs.brief_timezone}
                  disabled={!canManage || !!busy}
                  onChange={(e) => setPrefs({ ...prefs, brief_timezone: e.target.value })}
                  onBlur={() => savePrefs(prefs)}
                  className="w-36 rounded-lg border border-border bg-background px-2 py-1.5"
                  placeholder="e.g. Asia/Karachi"
                />
              </div>
            )}
          </div>
          <div className="rounded-2xl bg-primary/[0.06] p-4">
            <h4 className="text-[13px] font-semibold">Use Mellox as your Slack agent</h4>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              {state?.connection?.linked
                ? "Your Slack user is linked. Mellox checks your current role every time you ask or approve."
                : "Link your own Slack user to this client workspace. Mellox checks your current role every time you ask or approve."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run("link", async () => {
                    const result = await createSlackLinkCode({ data: { workspaceId } });
                    setCode(result.code);
                  })
                }
              >
                {state?.connection?.linked ? "Relink account" : "Get link code"}
              </Button>
              {code && (
                <span className="text-[12px]">
                  DM <strong>Mellox</strong>{" "}
                  <code className="rounded bg-background px-1.5 py-1">link {code}</code> within 10
                  minutes
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
            {canManage && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || !mapped("marketing")}
                  onClick={() =>
                    void run(
                      "test",
                      () => sendSlackTest({ data: { workspaceId, purpose: "marketing" } }),
                      "Test delivered",
                    )
                  }
                >
                  Send test message
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() =>
                    void run("reconnect", async () => {
                      const result = await startSlackConnect({ data: { workspaceId } });
                      window.location.assign(result.url);
                    })
                  }
                >
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => {
                    if (window.confirm("Disconnect Slack from this Mellox workspace?"))
                      void run(
                        "disconnect",
                        () => disconnectSlack({ data: { workspaceId } }),
                        "Slack disconnected",
                      );
                  }}
                >
                  Disconnect
                </Button>
              </>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {state?.connection?.lastOutboundAt
                ? `Last message ${new Date(state.connection.lastOutboundAt).toLocaleString()}`
                : "No messages sent yet"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
