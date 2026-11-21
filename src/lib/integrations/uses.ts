// What each connected app is for, and where in Mellox it is used (ADR-0042).
// Pure and browser-safe. The connector's opened view shows these as "Use it
// now" buttons once the app is connected, and Analytics shows the benefit on
// its connect tiles — so a connection always leads somewhere real.
//
// Every place here exists. A use names a place to open; it never runs
// anything by itself: the work there is still a person's click.

export type AppPlace =
  /** Analytics, on a tab. */
  | { kind: "analytics"; tab: "overview" | "social" | "ads" }
  /** Studio on a format. */
  | { kind: "create"; choice: "ad" | "social" | "image" | "carousel" | "article" | "video" }
  | { kind: "calendar" }
  | { kind: "library" }
  | { kind: "brain"; section: "brand" | "audience" | "strategy"; tab?: string }
  | { kind: "campaigns" };

export type AppUseIcon =
  | "chart"
  | "megaphone"
  | "users"
  | "mail"
  | "folder"
  | "sheet"
  | "palette"
  | "calendar"
  | "target"
  | "send";

export type AppUse = {
  icon: AppUseIcon;
  /** What the person gets, in a few words. */
  title: string;
  /** Where it happens and how, one sentence. */
  detail: string;
  /** The button that takes them there. */
  action: { label: string; place: AppPlace };
};

const SOCIAL = (network: string): AppUse[] => [
  {
    icon: "chart",
    title: "Every post's numbers",
    detail: `What you post on ${network}, made in Mellox or not, with views, likes and comments, in Analytics → Social. Read every few hours.`,
    action: { label: "See Social analytics", place: { kind: "analytics", tab: "social" } },
  },
  {
    icon: "send",
    title: "Post and schedule from Mellox",
    detail: `Pick ${network} when you approve or schedule a post; it goes out at its time.`,
    action: { label: "Open the calendar", place: { kind: "calendar" } },
  },
];

export const APP_USES: Record<string, AppUse[]> = {
  instagram: SOCIAL("Instagram"),
  facebook: SOCIAL("your Facebook Page"),
  youtube: SOCIAL("YouTube"),
  pinterest: SOCIAL("Pinterest"),
  linkedin: [
    {
      icon: "send",
      title: "Post and schedule from Mellox",
      detail: "Pick LinkedIn when you approve or schedule a post; it goes out at its time.",
      action: { label: "Open the calendar", place: { kind: "calendar" } },
    },
  ],
  googleads: [
    {
      icon: "chart",
      title: "Spend, clicks and conversions",
      detail:
        "Your campaigns' last 30 days in Analytics → Ads & leads, with cost per conversion. Read every few hours.",
      action: { label: "See ad results", place: { kind: "analytics", tab: "ads" } },
    },
    {
      icon: "megaphone",
      title: "Studio ads become campaigns",
      detail:
        "Make an ad in Studio, then press Google Ads under it: the ad, a budget and keywords Google suggests for your site, made paused for you to turn on.",
      action: { label: "Make an ad", place: { kind: "create", choice: "ad" } },
    },
  ],
  hubspot: [
    {
      icon: "users",
      title: "New contacts, measured",
      detail:
        "How many contacts joined HubSpot in the last 30 days, and the change, in Analytics → Ads & leads.",
      action: { label: "See leads", place: { kind: "analytics", tab: "ads" } },
    },
    {
      icon: "target",
      title: "A leads goal that counts itself",
      detail:
        "Set a leads goal in Brain and its progress is HubSpot's real count, never an estimate.",
      action: { label: "Set a goal", place: { kind: "brain", section: "brand", tab: "goal" } },
    },
  ],
  gmail: [
    {
      icon: "mail",
      title: "Posts and articles as drafts",
      detail:
        "Under any finished piece, press Gmail draft: it is saved in your Drafts, ready to address and send. Mellox never sends.",
      action: { label: "Open the Library", place: { kind: "library" } },
    },
  ],
  mailchimp: [
    {
      icon: "mail",
      title: "Email campaigns from your posts",
      detail:
        "In a piece's review, the Email section makes a Mailchimp draft campaign for the audience you pick. You check and send it there.",
      action: { label: "Open the Library", place: { kind: "library" } },
    },
  ],
  googledrive: [
    {
      icon: "folder",
      title: "Finished posts in your Drive",
      detail:
        "Under any finished piece, press Save to Drive: its pictures and text go to a Mellox folder.",
      action: { label: "Open the Library", place: { kind: "library" } },
    },
  ],
  googlesheets: [
    {
      icon: "sheet",
      title: "Your calendar as a sheet",
      detail:
        "In the content calendar, Export → New Google Sheet makes a sheet of exactly the posts on screen.",
      action: { label: "Open the calendar", place: { kind: "calendar" } },
    },
  ],
  canva: [
    {
      icon: "palette",
      title: "Edit any picture in Canva",
      detail:
        "On a finished picture or carousel, press Canva. Carousels open with their words editable; bring your edit back and the post uses it.",
      action: { label: "Open the Library", place: { kind: "library" } },
    },
  ],
};

export function appUses(app: string): AppUse[] {
  return APP_USES[app] ?? [];
}
