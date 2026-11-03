// chat-context.ts — the analytics snapshot the Mellox chat sees. Every line
// names its data source, and sources are listed separately so the assistant
// never adds GA4 visits to Search Console clicks, social views or the AI
// Visibility score.
import type { Comparison } from "./compare";
import { formatMetric, METRICS, type MetricKey } from "./metrics";
import { formatWindow } from "./ranges";
import { DATA_SOURCES } from "./sources";
import type { Kpi, OverviewReport, SourceStatus } from "./types";

function change(key: MetricKey, c: Comparison): string {
  if (c.status === "insufficient_history") return "no earlier data to compare";
  if (c.status === "no_data" || c.previous === null) return "no data";
  if (c.direction === "flat") return `about the same as before (${formatMetric(key, c.previous)})`;
  const pct = c.pct === null ? "" : ` (${c.pct > 0 ? "+" : ""}${c.pct}%)`;
  return `${c.direction} from ${formatMetric(key, c.previous)}${pct}`;
}

function kpiLines(kpis: Kpi[]): string[] {
  return kpis.map(
    (k) =>
      `  - ${METRICS[k.key].label} (${METRICS[k.key].hint}): ${formatMetric(k.key, k.value)}, ${change(k.key, k.comparison)}`,
  );
}

function statusLine(status: SourceStatus): string | null {
  switch (status.state) {
    case "ready":
      return null;
    case "not_configured":
    case "not_connected":
      return "  - Not connected.";
    case "no_source":
      return "  - Google is connected but no property/site is chosen.";
    case "syncing":
      return "  - First sync still running; no data yet.";
    case "reconnect":
      return "  - Needs reconnecting (Google access expired or was removed).";
    case "error":
      return `  - Unavailable: ${status.message ?? "sync failed"}.`;
  }
}

export function buildChatContext(report: OverviewReport): string {
  const lines: string[] = [
    `Analytics — last 28 days vs the 28 days before. Sources are separate measurements; never add or compare numbers across them.`,
  ];

  lines.push(
    `${DATA_SOURCES.ga4.label} (website visits)${report.website.window ? ` — ${formatWindow(report.website.window.current)}` : ""}:`,
  );
  lines.push(
    ...(statusLine(report.website.status)
      ? [statusLine(report.website.status)!]
      : kpiLines(report.website.kpis)),
  );

  lines.push(
    `${DATA_SOURCES.gsc.label} (Google Search results)${report.search.window ? ` — ${formatWindow(report.search.window.current)}` : ""}:`,
  );
  lines.push(
    ...(statusLine(report.search.status)
      ? [statusLine(report.search.status)!]
      : kpiLines(report.search.kpis)),
  );

  lines.push(`${DATA_SOURCES.geo.label} (AI answer readiness score, not traffic):`);
  if (report.aiVisibility.latest) {
    lines.push(
      `  - Latest score ${formatMetric("geo.score", report.aiVisibility.latest.score)} on ${report.aiVisibility.latest.scannedAt.slice(0, 10)}; ${change("geo.score", report.aiVisibility.kpi.comparison)}`,
    );
  } else {
    lines.push("  - No scan yet.");
  }

  const social = report.social;
  lines.push(
    `${DATA_SOURCES.social.label} (numbers the networks report for posts that went out in the period)${social.window ? ` — ${formatWindow(social.window.current)}` : ""}:`,
  );
  if (social.status.state !== "ready") {
    lines.push(
      social.status.state === "syncing"
        ? "  - Accounts connected; posts are still being read."
        : "  - No social account connected.",
    );
  } else {
    lines.push(...kpiLines(social.kpis.filter((k) => k.value !== null)));
    for (const p of social.byPlatform.slice(0, 5))
      lines.push(
        `  - ${p.platform}: ${p.posts} posts${p.views !== null ? `, ${formatMetric("social.views", p.views)} views` : ""}${p.engagement !== null ? `, ${formatMetric("social.engagement", p.engagement)} interactions` : ""}`,
      );
  }

  lines.push(`${DATA_SOURCES.mellox.label} (activity in Mellox):`);
  lines.push(...kpiLines(report.mellox.kpis));
  return lines.join("\n").slice(0, 3200);
}
