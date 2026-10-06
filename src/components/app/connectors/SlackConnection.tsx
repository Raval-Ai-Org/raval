"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
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
import { ConnectionCard } from "./ConnectionCard";

type State = Awaited<ReturnType<typeof getSlackConnection>>;
type Purpose = "approvals" | "marketing" | "intelligence";
const mapping: { purpose: Purpose; title: string; description: string }[] = [
  { purpose: "approvals", title: "Approvals", description: "Posts waiting for a yes or no" },
  { purpose: "marketing", title: "Marketing", description: "Daily brief and posts that failed" },
  { purpose: "intelligence", title: "Insights", description: "Competitor, market and results" },
];
const preferences = [
  ["approvals", "Posts to approve", "Approve or reject with a button", "approvals"],
  ["publishing_failures", "Posts that failed", "Know when a post didn’t go out", "marketing"],
  ["daily_brief", "Daily brief", "One short update each day", "marketing"],
  ["competitor_alerts", "Competitor moves", "Big changes only", "intelligence"],
  ["market_alerts", "Market openings", "The most promising ones", "intelligence"],
  ["geo_alerts", "AI Visibility changes", "When your score moves", "intelligence"],
  ["performance_alerts", "Results dropping", "When numbers fall", "intelligence"],
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
const field =
  "min-h-9 rounded-xl border border-border bg-background px-3 text-[13px] text-foreground disabled:opacity-50";

function SlackMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 54 54" className="size-7 shrink-0">
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

function timeZones(current: string) {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    /* Older browsers: the saved zone is still listed. */
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function Step({
  n,
  title,
  hint,
  children,
}: React.PropsWithChildren<{ n: number; title: string; hint: string }>) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-foreground">
          {n}
        </span>
        <h4 className="text-[13px] font-semibold text-foreground">{title}</h4>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
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
  const [invite, setInvite] = useState<Partial<Record<Purpose, string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const loadedChannels = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const data = await getSlackConnection({ data: { workspaceId } });
      setState(data);
      setPrefs(
        data.preferences
          ? { ...defaults, ...(data.preferences as Partial<Prefs>) }
          : // First time: the brief follows the person's own clock.
            { ...defaults, brief_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      );
      setError("");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Slack.");
      return null;
    }
  }, [workspaceId]);
  const connected = state?.connection?.status === "active";
  const needsReconnect = state?.connection?.status === "reconnect_needed";
  useEffect(() => {
    void refresh().then((data) => {
      // Nothing is sent until a channel is chosen, so open the setup by itself.
      if (data?.connection?.status === "active" && !data.channels.length) setExpanded(true);
    });
  }, [refresh]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("slack") !== "connected") return;
    toast.success("Slack connected");
    setExpanded(true);
    url.searchParams.delete("slack");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  const run = async (label: string, work: () => Promise<unknown>, message?: string) => {
    setBusy(label);
    setError("");
    try {
      await work();
      if (message) toast.success(message);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Slack could not do that.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (!connected || !expanded || !canManage || loadedChannels.current) return;
    loadedChannels.current = true;
    void listSlackChannels({ data: { workspaceId } })
      .then(setChannels)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Slack channels."));
  }, [connected, expanded, canManage, workspaceId]);
  const zones = useMemo(() => timeZones(prefs.brief_timezone), [prefs.brief_timezone]);
  const mapped = (purpose: Purpose) => state?.channels.find((c) => c.purpose === purpose);
  const connect = () =>
    void run("connect", async () => {
      const result = await startSlackConnect({ data: { workspaceId } });
      window.location.assign(result.url);
    });
  const changeChannel = (purpose: Purpose, channelId: string) =>
    run(`channel:${purpose}`, async () => {
      const result = await setSlackChannel({
        data: { workspaceId, purpose, channelId: channelId || null },
      });
      setInvite((all) => ({
        ...all,
        [purpose]: result.needsInvite ? (result.name ?? "") : undefined,
      }));
    });
  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    // Saved quietly: the switch itself is the confirmation.
    void setSlackPreferences({ data: { workspaceId, preferences: next } }).catch((e) => {
      toast.error(e instanceof Error ? e.message : "Could not save. Try again.");
      void refresh();
    });
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(`link ${code}`);
      toast.success("Copied. Paste it in a message to Mellox in Slack.");
    } catch {
      toast.message(`Send Mellox this in Slack: link ${code}`);
    }
  };
  const conn = state?.connection;
  return (
    <>
      <ConnectionCard
        label="Slack connection"
        logo={<SlackMark />}
        name="Slack"
        description="Review content, get a daily brief and ask Mellox about your brand, right in Slack."
        status={
          state
            ? connected
              ? { tone: "connected", text: "Connected" }
              : needsReconnect
                ? { tone: "attention", text: "Reconnect needed" }
                : { tone: "off", text: "Not connected" }
            : error
              ? { tone: "off", text: "Unavailable" }
              : null
        }
        detail={
          connected && conn
            ? [
                conn.teamName,
                conn.connectedBy ? `connected by ${conn.connectedBy}` : null,
                state.channels.length
                  ? conn.lastOutboundAt
                    ? `last message ${new Date(conn.lastOutboundAt).toLocaleDateString()}`
                    : "nothing sent yet"
                  : "choose a channel to start",
              ]
                .filter(Boolean)
                .join(" · ")
            : needsReconnect
              ? "Slack stopped accepting this connection. Connect again to keep it running."
              : undefined
        }
        actions={
          state?.enabled &&
          (connected ? (
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Close" : "Set up"}
            </Button>
          ) : (
            canManage && (
              <Button size="sm" disabled={!!busy || !state.configured} onClick={connect}>
                {busy === "connect" ? "Opening Slack…" : conn ? "Reconnect" : "Connect Slack"}
              </Button>
            )
          ))
        }
        note={
          state && !state.enabled
            ? "Slack isn’t switched on for this brand yet."
            : state && !connected && !state.configured
              ? (state.configurationMessage ?? "Slack is not set up on this server yet.")
              : state?.enabled && !connected && !canManage
                ? "Ask an owner or admin of this brand to connect Slack."
                : undefined
        }
        error={error || null}
      >
        {connected && expanded && (
          <div className="space-y-7">
            <Step
              n={1}
              title="Choose where Mellox posts"
              hint="Pick a channel for each kind of update. Leave one empty to skip it."
            >
              <div className="space-y-2">
                {mapping.map((m) => {
                  const current = mapped(m.purpose);
                  return (
                    <div key={m.purpose} className="rounded-2xl bg-[var(--ds-well-bg)] px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium">{m.title}</p>
                          <p className="text-[12px] text-muted-foreground">{m.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`${m.title} channel`}
                            value={current?.channel_id ?? ""}
                            disabled={!canManage || !!busy}
                            onChange={(e) => void changeChannel(m.purpose, e.target.value)}
                            className={`${field} min-w-[170px]`}
                          >
                            <option value="">No channel</option>
                            {current && !channels.some((c) => c.id === current.channel_id) && (
                              <option value={current.channel_id}>#{current.channel_name}</option>
                            )}
                            {channels.map((c) => (
                              <option key={c.id} value={c.id}>
                                #{c.name}
                              </option>
                            ))}
                          </select>
                          {canManage && current && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() =>
                                void run(
                                  `test:${m.purpose}`,
                                  async () => {
                                    await sendSlackTest({
                                      data: { workspaceId, purpose: m.purpose },
                                    });
                                    setInvite((all) => ({ ...all, [m.purpose]: undefined }));
                                  },
                                  `Sent to #${current.channel_name}`,
                                )
                              }
                            >
                              {busy === `test:${m.purpose}` ? "Sending…" : "Test"}
                            </Button>
                          )}
                        </div>
                      </div>
                      {invite[m.purpose] && current && (
                        <p className="mt-2 text-[12px] text-warning">
                          One more step: in Slack, open #{current.channel_name} and type{" "}
                          <code className="rounded bg-background px-1.5 py-0.5">
                            /invite @Mellox
                          </code>
                          , then press Test.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Public channels are listed.{" "}
                {canManage && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      void run("channels", async () =>
                        setChannels(await listSlackChannels({ data: { workspaceId } })),
                      )
                    }
                    className="font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {busy === "channels" ? "Refreshing…" : "Refresh list"}
                  </button>
                )}
              </p>
            </Step>
            <Step n={2} title="Choose what to send" hint="Each update goes to its channel above.">
              <div className="divide-y divide-[var(--ds-tile-border)]">
                {preferences.map(([key, label, description, purpose]) => {
                  const ready = !!mapped(purpose);
                  return (
                    <div key={key} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{label}</p>
                        <p className="text-[12px] text-muted-foreground">
                          {ready
                            ? description
                            : `Choose a${purpose === "marketing" ? " Marketing" : purpose === "approvals" ? "n Approvals" : "n Insights"} channel first`}
                        </p>
                      </div>
                      <Switch
                        aria-label={label}
                        checked={ready && prefs[key]}
                        disabled={!canManage || !ready}
                        onCheckedChange={(value) => savePrefs({ ...prefs, [key]: value })}
                      />
                    </div>
                  );
                })}
              </div>
              {prefs.daily_brief && mapped("marketing") && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <label htmlFor={`slack-hour-${workspaceId}`}>Send the brief at</label>
                  <select
                    id={`slack-hour-${workspaceId}`}
                    value={prefs.brief_hour}
                    disabled={!canManage}
                    onChange={(e) => savePrefs({ ...prefs, brief_hour: Number(e.target.value) })}
                    className={field}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`slack-zone-${workspaceId}`} className="sr-only">
                    Time zone
                  </label>
                  <select
                    id={`slack-zone-${workspaceId}`}
                    value={prefs.brief_timezone}
                    disabled={!canManage}
                    onChange={(e) => savePrefs({ ...prefs, brief_timezone: e.target.value })}
                    className={`${field} max-w-[220px]`}
                  >
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </Step>
            <Step
              n={3}
              title="Link your own Slack account"
              hint={
                conn?.linked
                  ? "You’re linked. Message Mellox in Slack, or use the buttons on a post, and it acts as you."
                  : "Everyone does this once, so Mellox knows who is asking or approving."
              }
            >
              <div className="flex flex-wrap items-center gap-2">
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
                  {conn?.linked ? "Link again" : code ? "New code" : "Get link code"}
                </Button>
                {code && (
                  <>
                    <code className="rounded-lg bg-[var(--ds-well-bg)] px-2.5 py-1.5 text-[12px]">
                      link {code}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => void copyCode()}>
                      Copy
                    </Button>
                  </>
                )}
              </div>
              {code && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  In Slack, open a message to <strong>Mellox</strong> and send that line. It works
                  for 10 minutes.
                </p>
              )}
            </Step>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ds-tile-border)] pt-4">
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={connect}>
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        )}
      </ConnectionCard>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Slack?</AlertDialogTitle>
            <AlertDialogDescription>
              Mellox stops posting to Slack and stops answering there for this brand. Nothing in
              Mellox or Slack is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={() => {
                setConfirmOpen(false);
                setExpanded(false);
                void run(
                  "disconnect",
                  () => disconnectSlack({ data: { workspaceId } }),
                  "Slack disconnected",
                );
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
