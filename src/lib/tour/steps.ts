// The app tour: what a new person is shown, once, and where the card sits.
//
// Pure and browser-safe. A stop points at a real control through its
// `data-tour` name; the component (`src/components/app/tour/AppTour.tsx`)
// finds it, lights it and places the card with `placeCard`. A stop whose
// control isn't on screen is still shown, centred, so the tour never breaks
// when a layout changes. Add a stop here, and the matching `data-tour` on the
// control it points at.

export type TourSide = "top" | "bottom" | "left" | "right";

export type TourIcon =
  | "chat"
  | "autopilot"
  | "studio"
  | "library"
  | "brain"
  | "analytics"
  | "calendar"
  | "visibility"
  | "settings"
  | "share"
  | "inspo"
  | "credits"
  | "streak";

export type TourStop = {
  id: string;
  icon: TourIcon;
  title: string;
  body: string;
  /** One short, optional pointer shown under the body. */
  tip?: string;
  /** `data-tour` names, first one on screen wins. */
  anchors: string[];
  /** Where the card goes when there is room. */
  side: TourSide;
  /** The control lives in the sidebar, which must be open to show it. */
  sidebar: boolean;
};

const STOPS: TourStop[] = [
  {
    id: "chat",
    icon: "chat",
    title: "Ask Mox for anything",
    body: "A post, a plan, an idea or a question about your numbers. Mox already knows your brand.",
    tip: "Type / to jump to any part of the app.",
    anchors: ["chat"],
    side: "top",
    sidebar: false,
  },
  {
    id: "autopilot",
    icon: "autopilot",
    title: "Let Autopilot run your posts",
    body: "Set it up once from Home. Mellox plans and makes your posts every week, and you approve what goes out.",
    anchors: ["autopilot", "chat"],
    side: "top",
    sidebar: false,
  },
  {
    id: "create",
    icon: "studio",
    title: "Create anything in one tap",
    body: "Posts, carousels, Stories, videos, ads and articles. Write a line or press Surprise me, then Generate.",
    tip: "You can keep working while pieces are made: they show in the corner list.",
    anchors: ["create", "studio"],
    side: "right",
    sidebar: true,
  },
  {
    id: "brain",
    icon: "brain",
    title: "Brain is what Mellox knows",
    body: "Your brand, products, goal, audience, competitors and market. The more it knows, the better every piece.",
    anchors: ["brain"],
    side: "right",
    sidebar: true,
  },
  {
    id: "inspo",
    icon: "inspo",
    title: "Set your look in Inspo",
    body: "Pick a picture style or let Mox rotate them. Set colours, fonts and logo, and add your photos to Media.",
    tip: "Your logo only goes on pictures when you switch it on in Post look.",
    anchors: ["inspo"],
    side: "right",
    sidebar: true,
  },
  {
    id: "library",
    icon: "library",
    title: "Everything you made, in one place",
    body: "Every post, picture and video is saved in your Library. A heart teaches Mox what you like.",
    anchors: ["library"],
    side: "right",
    sidebar: true,
  },
  {
    id: "calendar",
    icon: "calendar",
    title: "Plan and schedule",
    body: "Your calendar shows what goes out when. Campaigns plan a launch or event post by post.",
    anchors: ["calendar", "campaigns"],
    side: "right",
    sidebar: true,
  },
  {
    id: "analytics",
    icon: "analytics",
    title: "See what is working",
    body: "Views, clicks and growth from your social accounts and website, and what to make more of.",
    anchors: ["analytics"],
    side: "right",
    sidebar: true,
  },
  {
    id: "visibility",
    icon: "visibility",
    title: "Get found by AI search",
    body: "See how assistants like ChatGPT read your website, and fix what holds it back.",
    anchors: ["visibility"],
    side: "right",
    sidebar: true,
  },
  {
    id: "communities",
    icon: "chat",
    title: "Join the conversations",
    body: "Mellox finds threads on Reddit and other forums where people ask about what you do.",
    anchors: ["communities"],
    side: "right",
    sidebar: true,
  },
  {
    id: "credits",
    icon: "credits",
    title: "Your credits",
    body: "Pictures and videos use credits; writing is included. Every price shows on the button first.",
    anchors: ["credits"],
    side: "right",
    sidebar: true,
  },
  {
    id: "account",
    icon: "settings",
    title: "Connect your accounts",
    body: "In Settings, link your social accounts, apps and AI assistants, so Mellox can post for you.",
    anchors: ["account"],
    side: "right",
    sidebar: true,
  },
  {
    id: "streak",
    icon: "streak",
    title: "Keep your streak going",
    body: "Post regularly and your streak and level grow. Mox gets better with every piece you make.",
    anchors: ["streak"],
    side: "bottom",
    sidebar: false,
  },
  {
    id: "share",
    icon: "share",
    title: "Bring in your team and clients",
    body: "Invite teammates, or send a client a link to approve posts.",
    anchors: ["share"],
    side: "bottom",
    sidebar: false,
  },
];

/** The stops for this person. A part of the app that is switched off is left out. */
export function tourStops(options: { autopilot: boolean }): TourStop[] {
  return STOPS.filter((stop) => stop.id !== "autopilot" || options.autopilot);
}

/** What the last card offers. Each one is a person's own click. */
export type TourFinishAction = "post" | "brain" | "accounts";

export const TOUR_FINISH: { id: TourFinishAction; icon: TourIcon; label: string }[] = [
  { id: "post", icon: "chat", label: "Write my first post" },
  { id: "brain", icon: "brain", label: "Check what Mellox knows" },
  { id: "accounts", icon: "settings", label: "Connect my accounts" },
];

export const TOUR_FIRST_POST_PROMPT = "Write 3 post ideas for this week";

export type TourRect = { left: number; top: number; width: number; height: number };
export type TourSize = { width: number; height: number };

const OPPOSITE: Record<TourSide, TourSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const clamp = (value: number, min: number, max: number) =>
  Math.round(Math.max(min, Math.min(value, Math.max(min, max))));

/**
 * Where the card's top-left corner goes: beside the lit control on the wanted
 * side when it fits, else the opposite side, else wherever there is most room.
 * Always inside the screen. With no control it is centred.
 */
export function placeCard(
  target: TourRect | null,
  card: TourSize,
  viewport: TourSize,
  prefer: TourSide,
  gap = 14,
  margin = 12,
): { left: number; top: number; side: TourSide | "center" } {
  const maxLeft = viewport.width - card.width - margin;
  const maxTop = viewport.height - card.height - margin;
  if (!target) {
    return {
      left: clamp((viewport.width - card.width) / 2, margin, maxLeft),
      top: clamp((viewport.height - card.height) / 2, margin, maxTop),
      side: "center",
    };
  }

  const room: Record<TourSide, number> = {
    top: target.top - gap - margin - card.height,
    bottom: viewport.height - (target.top + target.height) - gap - margin - card.height,
    left: target.left - gap - margin - card.width,
    right: viewport.width - (target.left + target.width) - gap - margin - card.width,
  };
  const cross: TourSide[] =
    prefer === "top" || prefer === "bottom" ? ["right", "left"] : ["bottom", "top"];
  const order: TourSide[] = [prefer, OPPOSITE[prefer], ...cross];
  const side =
    order.find((candidate) => room[candidate] >= 0) ??
    [...order].sort((a, b) => room[b] - room[a])[0];

  const centreX = target.left + target.width / 2 - card.width / 2;
  const centreY = target.top + target.height / 2 - card.height / 2;
  const raw =
    side === "top"
      ? { left: centreX, top: target.top - gap - card.height }
      : side === "bottom"
        ? { left: centreX, top: target.top + target.height + gap }
        : side === "left"
          ? { left: target.left - gap - card.width, top: centreY }
          : { left: target.left + target.width + gap, top: centreY };

  return {
    left: clamp(raw.left, margin, maxLeft),
    top: clamp(raw.top, margin, maxTop),
    side,
  };
}
