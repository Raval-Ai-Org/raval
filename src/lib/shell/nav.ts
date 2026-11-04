// The workspace sidebar as data (Mellox 2.0, ADR-0044). Holo's grouping:
// a short label over a few rows. The shell renders this list expanded and as
// the collapsed icon rail, so the two never drift apart. Pure and
// browser-safe; `nav.test.ts` checks the tour names and events.

import type { FeatureKey } from "@/lib/billing/catalog";

export type NavIcon =
  | "home"
  | "chat"
  | "brain"
  | "inspo"
  | "library"
  | "campaigns"
  | "calendar"
  | "analytics"
  | "visibility"
  | "communities"
  | "experiments"
  | "share"
  | "portal";

/** Where a row goes. Routes are workspace pages; events open a window. */
export type NavTarget =
  | {
      kind: "route";
      place: "home" | "chat" | "inspo" | "campaigns" | "communities" | "experiments";
    }
  | { kind: "brain" }
  | { kind: "analytics" }
  | {
      kind: "event";
      event:
        | "open:library"
        | "open:content-calendar"
        | "open:ai-visibility"
        | "open:share"
        | "open:client-portal";
    };

export type NavItem = {
  id: string;
  label: string;
  icon: NavIcon;
  target: NavTarget;
  /** The app tour's name for this row (`data-tour`). */
  tour?: string;
  /** Paid feature: a locked plan shows the plan and opens the upgrade screen. */
  feature?: FeatureKey;
  /** Shown only when a flag says so (Experiments). */
  flag?: "experiments";
  /** In the collapsed rail too. */
  rail?: boolean;
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      {
        id: "home",
        label: "Home",
        icon: "home",
        target: { kind: "route", place: "home" },
        tour: "home",
        rail: true,
      },
      {
        id: "chat",
        label: "Chat",
        icon: "chat",
        target: { kind: "route", place: "chat" },
        rail: true,
      },
    ],
  },
  {
    id: "brand",
    label: "Brand",
    items: [
      {
        id: "brain",
        label: "Brain",
        icon: "brain",
        target: { kind: "brain" },
        tour: "brain",
        rail: true,
      },
      {
        id: "inspo",
        label: "Inspo",
        icon: "inspo",
        target: { kind: "route", place: "inspo" },
        tour: "inspo",
      },
      {
        id: "library",
        label: "Library",
        icon: "library",
        target: { kind: "event", event: "open:library" },
        tour: "library",
        rail: true,
      },
    ],
  },
  {
    id: "create",
    label: "Create",
    items: [
      {
        id: "campaigns",
        label: "Campaigns",
        icon: "campaigns",
        target: { kind: "route", place: "campaigns" },
        tour: "campaigns",
        rail: true,
      },
      {
        id: "calendar",
        label: "Calendar",
        icon: "calendar",
        target: { kind: "event", event: "open:content-calendar" },
        tour: "calendar",
      },
    ],
  },
  {
    id: "grow",
    label: "Grow",
    items: [
      {
        id: "analytics",
        label: "Analytics",
        icon: "analytics",
        target: { kind: "analytics" },
        tour: "analytics",
        rail: true,
      },
      {
        id: "visibility",
        label: "AI Visibility",
        icon: "visibility",
        target: { kind: "event", event: "open:ai-visibility" },
        tour: "visibility",
      },
      {
        id: "communities",
        label: "Communities",
        icon: "communities",
        target: { kind: "route", place: "communities" },
        tour: "communities",
      },
      {
        id: "experiments",
        label: "Experiments",
        icon: "experiments",
        target: { kind: "route", place: "experiments" },
        feature: "experiments",
        flag: "experiments",
      },
    ],
  },
  {
    id: "team",
    label: "Team",
    items: [
      {
        id: "share",
        label: "Share",
        icon: "share",
        target: { kind: "event", event: "open:share" },
      },
      {
        id: "portal",
        label: "Client portal",
        icon: "portal",
        target: { kind: "event", event: "open:client-portal" },
        feature: "client_portal",
      },
    ],
  },
];

/** Which row a workspace path belongs to, for the sliding highlight. */
export function activeNavId(path: string, homePath: string, chatView: boolean): string | null {
  const p = path.replace(/\/$/, "");
  const home = homePath.replace(/\/$/, "");
  if (p === home) return chatView ? "chat" : "home";
  if (p.startsWith(`${home}/chat`)) return "chat";
  for (const id of ["brain", "inspo", "campaigns", "communities", "experiments"]) {
    if (p.startsWith(`${home}/${id}`)) return id;
  }
  return null;
}
