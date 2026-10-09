// The Publish list: everything a person approved that hasn't finished going
// out yet. Pure and browser-safe; the rows come from src/server/fns/publish.ts.
// It only describes rows that exist. Acting on one happens in the place that
// owns it (the post's own review, AI Visibility, Experiments, GitHub).

export type PublishGroup = "ready" | "scheduled" | "website" | "problems";

export type PublishEntry = {
  /** Unique across the list. */
  key: string;
  group: PublishGroup;
  title: string;
  /** One short, plain line about where this stands. */
  detail: string;
  at: string | null;
  /** Opens the post's own review. */
  contentItemId?: string;
  /** A pull request or live page to open in a new tab. */
  href?: string;
  hrefLabel?: string;
  /** A place inside Mellox that owns this row. */
  place?: "visibility" | "experiments";
};

export type PublishQueue = Record<PublishGroup, PublishEntry[]>;

export type ContentRow = {
  id: string;
  title: string | null;
  body: string | null;
  kind: string | null;
  channel: string | null;
  status: string;
  scheduled_at: string | null;
  updated_at: string | null;
};

export type PublicationRow = {
  id: string;
  content_item_id: string | null;
  title: string | null;
  host: string | null;
  status: string;
  status_detail: string | null;
  url: string | null;
  pr_url: string | null;
  updated_at: string | null;
};

export type PullRequestRow = {
  id: string;
  source: "fix" | "fix_batch" | "experiment" | "blog";
  label: string | null;
  pr_url: string | null;
  pr_number: number | null;
  updated_at: string | null;
};

const CHANNEL_NAMES: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  twitter: "X",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  blog: "Blog",
};

const KIND_NAMES: Record<string, string> = {
  post: "Post",
  carousel: "Carousel",
  story: "Story",
  image: "Picture",
  video: "Video",
  ad: "Ad",
  script: "Script",
  blog: "Article",
};

export function contentTitle(row: Pick<ContentRow, "title" | "body">): string {
  const title = row.title?.trim();
  if (title) return title;
  const body = row.body?.replace(/\s+/g, " ").trim();
  if (!body) return "Untitled";
  return body.length > 70 ? `${body.slice(0, 69).trimEnd()}…` : body;
}

function contentLabel(row: ContentRow): string {
  const kind = KIND_NAMES[row.kind ?? ""] ?? "Post";
  const channel = row.channel ? (CHANNEL_NAMES[row.channel.toLowerCase()] ?? row.channel) : null;
  return channel && kind !== "Article" ? `${kind} for ${channel}` : kind;
}

function contentEntry(row: ContentRow): PublishEntry | null {
  const base = {
    key: `content:${row.id}`,
    title: contentTitle(row),
    contentItemId: row.id,
  };
  const label = contentLabel(row);
  switch (row.status) {
    case "approved":
      return {
        ...base,
        group: "ready",
        detail: `${label} · approved, no time set`,
        at: row.updated_at,
      };
    case "scheduled":
      return { ...base, group: "scheduled", detail: label, at: row.scheduled_at };
    case "publishing":
      return {
        ...base,
        group: "scheduled",
        detail: `${label} · going out now`,
        at: row.updated_at,
      };
    case "failed":
      return { ...base, group: "problems", detail: `${label} · didn't go out`, at: row.updated_at };
    case "partial_failed":
      return {
        ...base,
        group: "problems",
        detail: `${label} · went out on some accounts only`,
        at: row.updated_at,
      };
    default:
      return null;
  }
}

function publicationEntry(row: PublicationRow): PublishEntry | null {
  const base = {
    key: `publication:${row.id}`,
    title: row.title?.trim() || "Article",
    at: row.updated_at,
    contentItemId: row.content_item_id ?? undefined,
  };
  const site = row.host ? ` on ${row.host}` : "";
  switch (row.status) {
    case "approved":
    case "publishing":
      return { ...base, group: "website", detail: `Article · being sent${site}` };
    case "pr_open":
      return {
        ...base,
        group: "website",
        detail: `Article · goes live when the pull request is merged`,
        href: row.pr_url ?? undefined,
        hrefLabel: "Pull request",
      };
    case "published":
    case "verifying":
      return {
        ...base,
        group: "website",
        detail: `Article · checking the live page${site}`,
        href: row.url ?? undefined,
        hrefLabel: "View page",
      };
    case "needs_attention":
    case "failed":
      return {
        ...base,
        group: "problems",
        detail: `Article · ${row.status_detail?.trim() || "couldn't be published"}`,
        href: row.pr_url ?? row.url ?? undefined,
        hrefLabel: row.pr_url ? "Pull request" : row.url ? "View page" : undefined,
      };
    default:
      return null;
  }
}

const PR_TITLES: Record<PullRequestRow["source"], string> = {
  fix: "Website fix",
  fix_batch: "Website fixes",
  experiment: "Experiment change",
  blog: "New blog pages",
};

function pullRequestEntry(row: PullRequestRow): PublishEntry | null {
  if (!row.pr_url) return null;
  const number = row.pr_number ? ` #${row.pr_number}` : "";
  return {
    key: `pr:${row.source}:${row.id}`,
    group: "website",
    title: row.label?.trim() || PR_TITLES[row.source],
    detail: `Pull request${number} · goes live when it is merged`,
    at: row.updated_at,
    href: row.pr_url,
    hrefLabel: "Pull request",
    place:
      row.source === "experiment"
        ? "experiments"
        : row.source === "blog"
          ? undefined
          : "visibility",
  };
}

const time = (value: string | null) => (value ? Date.parse(value) || 0 : 0);

export function buildPublishQueue(rows: {
  content: ContentRow[];
  publications: PublicationRow[];
  pullRequests: PullRequestRow[];
}): PublishQueue {
  const queue: PublishQueue = { ready: [], scheduled: [], website: [], problems: [] };
  const entries = [
    ...rows.content.map(contentEntry),
    ...rows.publications.map(publicationEntry),
    ...rows.pullRequests.map(pullRequestEntry),
  ];
  for (const entry of entries) if (entry) queue[entry.group].push(entry);
  // Scheduled reads like a timetable (next first); the rest newest first.
  queue.scheduled.sort((a, b) => time(a.at) - time(b.at));
  for (const group of ["ready", "website", "problems"] as const) {
    queue[group].sort((a, b) => time(b.at) - time(a.at));
  }
  return queue;
}

export function publishQueueCount(queue: PublishQueue): number {
  return queue.ready.length + queue.scheduled.length + queue.website.length + queue.problems.length;
}
