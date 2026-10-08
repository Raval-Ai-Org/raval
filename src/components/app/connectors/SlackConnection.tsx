"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { Building2, Check, Clock, Copy, User } from "@/components/icons";
import { SlackMark } from "@/components/brand/AppMarks";
import { ConnectionCard, ConnectionFact } from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { useConnectWindow } from "./useConnectWindow";

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
  "ds-well min-h-9 rounded-full border-0 px-3.5 text-[13px] text-foreground transition-colors hover:bg-[var(--ds-well-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

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
  done,
  children,
}: React.PropsWithChildren<{ n: number; title: string; hint?: string; done?: boolean }>) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <span
        className={
          done
            ? "grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
            : "grid size-6 place-items-center rounded-full bg-primary/15 text-[12px] font-semibold text-foreground"
        }
        aria-hidden
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0">
        <h4 className="text-[13.5px] font-semibold leading-6 text-foreground">{title}</h4>
        {hint && <p className="text-[12px] leading-5 text-muted-foreground">{hint}</p>}
        <div className="mt-3">{children}</div>
      </div>
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
  // Slack signs in in its own window; this hears when it closes.
  const slackWindow = useConnectWindow("slack", workspaceId, (result) => {
    if (result?.status === "connected") {
      toast.success("Slack connected");
      setExpanded(true);
    } else if (result?.status === "error") toast.error("Slack didn’t connect. Try again.");
    void refresh();
  });
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
    void run("connect", () =>
      slackWindow.connect(async () => (await startSlackConnect({ data: { workspaceId } })).url),
    );
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
        description="Approvals, a daily brief and answers in Slack"
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
        facts={
          connected && conn ? (
            <>
              {conn.teamName && <ConnectionFact icon={Building2}>{conn.teamName}</ConnectionFact>}
              {conn.connectedBy && <ConnectionFact icon={User}>{conn.connectedBy}</ConnectionFact>}
              {state.channels.length ? (
                <ConnectionFact icon={Clock}>
                  {conn.lastOutboundAt
                    ? `Last message ${new Date(conn.lastOutboundAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : "Nothing sent yet"}
                </ConnectionFact>
              ) : (
                <ConnectionFact tone="warning">Choose a channel</ConnectionFact>
              )}
            </>
          ) : undefined
        }
        actions={
          state?.enabled &&
          (connected ? (
            <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Close" : "Set up"}
            </Button>
          ) : (
            canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy || !state.configured}
                onClick={connect}
              >
                {busy === "connect"
                  ? "Opening…"
                  : slackWindow.waiting
                    ? "Waiting for Slack…"
                    : conn
                      ? "Reconnect"
                      : "Connect"}
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
              title="Where to post"
              hint="One channel for each kind of update."
              done={state.channels.length > 0}
            >
              <div className="space-y-2">
                {mapping.map((m) => {
                  const current = mapped(m.purpose);
                  return (
                    <div key={m.purpose} className="ds-well px-4 py-3">
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
            <Step n={2} title="What to send">
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
              title="Link your Slack account"
              hint={
                conn?.linked
                  ? "Linked. In Slack, Mellox acts as you."
                  : "Once per person, so Mellox knows who is asking."
              }
              done={!!conn?.linked}
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
                    <code className="ds-well rounded-full px-3 py-1.5 text-[12px]">
                      link {code}
                    </code>
                    <Button size="sm" variant="ghost" onClick={() => void copyCode()}>
                      <Copy className="size-3.5" /> Copy
                    </Button>
                  </>
                )}
              </div>
              {code && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Send this to <strong>Mellox</strong> in Slack within 10 minutes.
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
      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name="Slack"
        description="Mellox stops posting and answering in Slack. Nothing is deleted."
        busy={!!busy}
        onConfirm={() => {
          setConfirmOpen(false);
          setExpanded(false);
          void run(
            "disconnect",
            () => disconnectSlack({ data: { workspaceId } }),
            "Slack disconnected",
          );
        }}
      />
    </>
  );
}
