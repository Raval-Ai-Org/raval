// alerts.ts — operational alerts to a chat webhook (Slack- or Discord-
// compatible JSON), proposal workstream G: "background-job heartbeats and AI
// spend anomaly alerts". Deduplicated per alert key for a cooldown window in
// the shared cache, so a failing job alerts once an hour, not every minute.
import "server-only";
import { cache } from "@/server/cache/store";
import { log } from "./logger";

export type Alert = {
  key: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
};

const COOLDOWN_SECONDS = 3600;

export type AlertSink = (alert: Alert) => Promise<void>;

const webhookSink: AlertSink = async (alert) => {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const text = `${alert.severity === "critical" ? "🔴" : "🟠"} *${alert.title}*\n${alert.detail}`;
  // `text` for Slack, `content` for Discord — both ignore the other field.
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5000),
  });
};

let sink: AlertSink = webhookSink;

export function setAlertSink(next: AlertSink | null): void {
  sink = next ?? webhookSink;
}

/** Send an alert unless the same key alerted within the cooldown. Returns whether it was sent. */
export async function sendAlert(alert: Alert): Promise<boolean> {
  const n = await cache.incr(`alert:${alert.key}`, COOLDOWN_SECONDS);
  if (n > 1) return false;
  log.warn(`alert: ${alert.title}`, { key: alert.key, severity: alert.severity, detail: alert.detail });
  try {
    await sink(alert);
  } catch (error) {
    log.error("alert delivery failed", { error });
  }
  return true;
}
