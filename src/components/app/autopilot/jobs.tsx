// Every job Autopilot can run for a workspace, on or off, with where it stands.
// One list, read from the view, shown on the home page and in the message box.
import type { ComponentType } from "react";
import { Eye, Gauge, Mail, Megaphone, Pencil, Repeat, Story } from "@/components/icons";
import type { AutopilotView } from "@/lib/autopilot/contracts";
import type { OpenTarget, Section } from "./AutopilotScreen";
import { platformLabel, timeAgo } from "./autopilot-ui";

/** Where pressing something leads: a section here, or a place elsewhere in Mellox. */
export type Go = { section: Section } | { open: OpenTarget };

export type Job = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** A word or two for tight places. */
  short: string;
  on: boolean;
  state: string;
  /** A figure worth showing by itself (the AI visibility score). */
  figure?: string;
  attention?: boolean;
  go: Go;
};

function paceText(program: NonNullable<AutopilotView["program"]>): string {
  const where = program.platforms.map((p) => platformLabel(p)).join(", ");
  return `${program.postsPerWeek} a week${where ? ` · ${where}` : ""}`;
}

export function jobsFor(view: AutopilotView): Job[] {
  const program = view.program!;
  const has = (name: (typeof program.automations)[number]) => program.automations.includes(name);
  const task = (name: string) => view.tasks.find((t) => t.contentType === name);
  const settings: Go = { section: "settings" };
  const jobs: Job[] = [];

  jobs.push({
    id: "posts",
    icon: Megaphone,
    label: "Posts",
    short: "Posts",
    on: program.postsPerWeek > 0,
    state: program.postsPerWeek > 0 ? paceText(program) : "Off",
    go: { open: "calendar" },
  });

  const stories = view.stories;
  jobs.push({
    id: "stories",
    icon: Story,
    label: "Daily Stories",
    short: "Stories",
    on: Boolean(stories?.enabled),
    attention: Boolean(stories?.waiting),
    state: !stories?.enabled
      ? "Off"
      : stories.waiting
        ? `${stories.waiting} waiting for your OK`
        : stories.times.length
          ? `Around ${stories.times.join(", ")}${stories.timing === "learned" ? " · your best times" : ""}`
          : "Planned with next week",
    go: stories?.waiting ? { section: "approvals" } : settings,
  });

  const articles = program.contentTypes.includes("article");
  const toSite = has("publish_articles");
  jobs.push({
    id: "articles",
    icon: Pencil,
    label: toSite ? "Articles to your website" : "Articles",
    short: "Articles",
    on: articles,
    attention: articles && toSite && !view.site,
    state: !articles
      ? "Off"
      : !toSite
        ? "One a week · kept in your content"
        : view.site
          ? `One a week · sent to ${view.site.host}`
          : "Connect your blog to send them",
    go: articles && toSite && !view.site ? { open: "blog" } : settings,
  });

  const scan = task("geo_scan");
  jobs.push({
    id: "visibility",
    icon: Gauge,
    label: "AI visibility",
    short: "AI visibility",
    on: has("geo_scan"),
    figure: view.visibility?.score != null ? String(view.visibility.score) : undefined,
    state: !has("geo_scan")
      ? "Weekly check is off"
      : scan?.status === "skipped"
        ? "Add your website to start"
        : view.visibility?.scannedAt
          ? `Checked ${timeAgo(view.visibility.scannedAt)} · weekly`
          : "First check is running",
    go: { open: "visibility" },
  });

  jobs.push({
    id: "market",
    icon: Eye,
    label: "Market and competitors",
    short: "Market watch",
    on: true,
    state: view.opportunities.length
      ? `${view.opportunities.length} ${view.opportunities.length === 1 ? "idea" : "ideas"} found`
      : "Watching. Nothing new.",
    go: { section: "ideas" },
  });

  const reuse = task("repurpose");
  jobs.push({
    id: "reuse",
    icon: Repeat,
    label: "Reuse what worked",
    short: "Reuse",
    on: has("repurpose"),
    state: !has("repurpose")
      ? "Off"
      : reuse?.status === "done"
        ? `Best post reused ${timeAgo(reuse.updatedAt)}`
        : reuse?.status === "skipped"
          ? "Waiting for posts with results"
          : "Starts with your next plan",
    go: settings,
  });

  const report = task("weekly_report");
  jobs.push({
    id: "summary",
    icon: Mail,
    label: "Weekly summary email",
    short: "Weekly email",
    on: has("weekly_report"),
    state: !has("weekly_report")
      ? "Off"
      : report?.status === "done"
        ? `Sent ${timeAgo(report.updatedAt)}`
        : report?.status === "skipped" && report.error
          ? report.error
          : "Goes out when the week ends",
    go: settings,
  });

  return jobs;
}
