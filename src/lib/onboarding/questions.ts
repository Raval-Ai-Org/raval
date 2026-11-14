// The onboarding questions as data (ADR-0049): one question per screen, a tap
// answers and moves on, Mox talks between them while the scan runs.
//
// Pure and browser-safe. `askScreens` decides the sequence; the UI only draws
// what it is given. Where each answer lands is in answers.ts.
import { FOCUS_LABELS, GOAL_FOCUSES, type GoalFocus } from "@/lib/goals/contracts";
import {
  recommendedRhythm,
  type Activity,
  type Approval,
  type Answers,
  type EmojiChoice,
  type LengthChoice,
  type Rhythm,
  type Role,
  type SignupSource,
  type TeamSize,
  type ToneChoice,
} from "./answers";
import type { FlowMode } from "./flow";

/** What a card shows. Images come from art.ts; the rest is drawn in code. */
export type CardArt =
  | { kind: "image"; id: string }
  | { kind: "team"; count: 1 | 2 | 4 | 7 }
  | { kind: "calendar"; days: number }
  | { kind: "lines"; count: 1 | 3 | 6 }
  | { kind: "smiles"; count: 0 | 1 | 3 }
  | { kind: "mox" }
  | { kind: "icon"; name: "search" | "share" | "friend" | "sparkle" | "more" };

export type Option<V extends string | number = string | number> = {
  value: V;
  label: string;
  hint?: string;
  art: CardArt;
  recommended?: boolean;
};

/** A title is plain text with one **highlighted** part (drawn in the Mox gradient). */
export type PickScreen = {
  kind: "pick";
  id:
    | "role"
    | "teamSize"
    | "focus"
    | "activity"
    | "rhythm"
    | "approval"
    | "tone"
    | "emoji"
    | "length"
    | "source";
  title: string;
  sub?: string;
  options: Option[];
  /** Cards per row on wide screens. */
  columns: 2 | 3 | 4;
};

export type ChannelsScreen = { kind: "channels"; id: "channels"; title: string; sub: string };
export type SwipeScreen = { kind: "swipe"; id: "look"; title: string; sub: string };
export type SayScreen = {
  kind: "say";
  id: string;
  /** Lines with **bold** parts; typed out one after the other. */
  lines: string[];
  pose: string;
  /** Where Mox stands. */
  side: "right" | "center";
};

export type AskScreen = PickScreen | ChannelsScreen | SwipeScreen | SayScreen;

const ROLE_OPTIONS: Option<Role>[] = [
  {
    value: "owner",
    label: "Owner",
    hint: "It's my business",
    art: { kind: "image", id: "role-owner" },
  },
  {
    value: "marketing",
    label: "Marketing team",
    hint: "I market a brand",
    art: { kind: "image", id: "role-team" },
  },
  {
    value: "agency",
    label: "Agency / freelancer",
    hint: "I work for clients",
    art: { kind: "image", id: "role-agency" },
  },
  {
    value: "creator",
    label: "Creator",
    hint: "I'm the brand",
    art: { kind: "image", id: "role-creator" },
  },
];

const TEAM_OPTIONS: Option<TeamSize>[] = [
  { value: "solo", label: "Just me", art: { kind: "team", count: 1 } },
  { value: "small", label: "2–10", art: { kind: "team", count: 2 } },
  { value: "mid", label: "11–100", art: { kind: "team", count: 4 } },
  { value: "large", label: "100+", art: { kind: "team", count: 7 } },
];

const GOAL_ART: Record<GoalFocus, string> = {
  followers: "goal-followers",
  reach: "goal-reach",
  leads: "goal-leads",
  sales: "goal-sales",
  engagement: "goal-engagement",
  launch: "goal-launch",
};

const ACTIVITY_OPTIONS: Option<Activity>[] = [
  {
    value: "very",
    label: "Very active",
    hint: "Posting most days",
    art: { kind: "calendar", days: 6 },
  },
  { value: "regular", label: "Regularly", hint: "Every week", art: { kind: "calendar", days: 3 } },
  {
    value: "sometimes",
    label: "Now and then",
    hint: "When I find time",
    art: { kind: "calendar", days: 1 },
  },
  {
    value: "not_yet",
    label: "Not yet",
    hint: "Starting fresh",
    art: { kind: "calendar", days: 0 },
  },
];

const RHYTHM_LABELS: Record<Rhythm, { label: string; hint: string }> = {
  7: { label: "Every day", hint: "7 posts a week" },
  4: { label: "Every other day", hint: "4 posts a week" },
  3: { label: "A few times a week", hint: "3 posts a week" },
  1: { label: "Once a week", hint: "1 post a week" },
};

const TONE_OPTIONS: Option<ToneChoice>[] = [
  {
    value: "corporate",
    label: "Corporate",
    hint: "Polished and precise",
    art: { kind: "image", id: "tone-corporate" },
  },
  {
    value: "casual",
    label: "Business casual",
    hint: "Friendly but sharp",
    art: { kind: "image", id: "tone-casual" },
  },
  {
    value: "personal",
    label: "Personal",
    hint: "Warm and real",
    art: { kind: "image", id: "tone-personal" },
  },
  {
    value: "funny",
    label: "Funny",
    hint: "Light and playful",
    art: { kind: "image", id: "tone-funny" },
  },
  {
    value: "auto",
    label: "Let Mox decide",
    hint: "Match my site's voice",
    art: { kind: "mox" },
    recommended: true,
  },
];

const EMOJI_OPTIONS: Option<EmojiChoice>[] = [
  { value: "none", label: "No emoji", art: { kind: "smiles", count: 0 } },
  { value: "few", label: "A few here and there", art: { kind: "smiles", count: 1 } },
  { value: "plenty", label: "Plenty", art: { kind: "smiles", count: 3 } },
  { value: "auto", label: "Let Mox decide", art: { kind: "mox" } },
];

const LENGTH_OPTIONS: Option<LengthChoice>[] = [
  { value: "short", label: "Short and punchy", art: { kind: "lines", count: 1 } },
  { value: "paragraph", label: "A paragraph", art: { kind: "lines", count: 3 } },
  { value: "long", label: "Long and detailed", art: { kind: "lines", count: 6 } },
  {
    value: "auto",
    label: "Let Mox decide",
    hint: "Fits each platform",
    art: { kind: "mox" },
    recommended: true,
  },
];

const APPROVAL_OPTIONS: Option<Approval>[] = [
  {
    value: "autopilot",
    label: "I approve each post",
    hint: "Mox plans and makes, you say yes",
    art: { kind: "image", id: "pose-thumbs" },
    recommended: true,
  },
  {
    value: "assist",
    label: "I approve the plan too",
    hint: "The week's plan first, then each post",
    art: { kind: "image", id: "pose-calendar" },
  },
  {
    value: "full",
    label: "Fully automatic",
    hint: "Safe posts go out, anything unsure waits",
    art: { kind: "image", id: "goal-launch" },
  },
];

const SOURCE_OPTIONS: Option<SignupSource>[] = [
  { value: "google", label: "Google", art: { kind: "icon", name: "search" } },
  { value: "social", label: "Social media", art: { kind: "icon", name: "share" } },
  { value: "friend", label: "A friend", art: { kind: "icon", name: "friend" } },
  { value: "ai", label: "An AI assistant", art: { kind: "icon", name: "sparkle" } },
  { value: "other", label: "Somewhere else", art: { kind: "icon", name: "more" } },
];

/** Mox's answer to the tone pick (a short beat before the next question). */
export const TONE_REACTION: Record<ToneChoice, string> = {
  corporate: "Perfect. Mox will keep it **professional**.",
  casual: "Nice. **Friendly but sharp** it is.",
  personal: "Lovely. Mox will write like **a real person**.",
  funny: "Ha. Mox will keep it **light and fun**.",
  auto: "Got it. Mox will **match your site's voice**.",
};

export type AskContext = {
  mode: FlowMode;
  /** The account already said where it heard of Mellox (asked once per account). */
  sourceKnown: boolean;
};

/** Every screen between the website and the brand reveal, in order. */
export function askScreens(a: Answers, ctx: AskContext): AskScreen[] {
  const recommended = recommendedRhythm(a.activity, a.focus);
  const fromSite = ctx.mode === "site";
  const screens: AskScreen[] = [
    {
      kind: "say",
      id: "hello",
      lines: fromSite
        ? [
            "Hi, I'm **Mox**.",
            "While I read your site, a few quick taps so your posts sound like **you**.",
          ]
        : ["Hi, I'm **Mox**.", "A few quick taps so your posts sound like **you**."],
      pose: "wave",
      side: "right",
    },
    { kind: "pick", id: "role", title: "Pick your **role**", options: ROLE_OPTIONS, columns: 4 },
    {
      kind: "pick",
      id: "teamSize",
      title: "How big is the **team**?",
      options: TEAM_OPTIONS,
      columns: 4,
    },
    {
      kind: "pick",
      id: "focus",
      title: "What should your marketing **do**?",
      sub: "Pick the one that matters most. Numbers can come later.",
      options: GOAL_FOCUSES.map((f) => ({
        value: f,
        label: FOCUS_LABELS[f].label,
        hint: FOCUS_LABELS[f].hint,
        art: { kind: "image", id: GOAL_ART[f] },
      })),
      columns: 3,
    },
    {
      kind: "pick",
      id: "activity",
      title: "How **active** are you on social today?",
      options: ACTIVITY_OPTIONS,
      columns: 2,
    },
    {
      kind: "pick",
      id: "rhythm",
      title: "How **often** should Mox post for you?",
      sub: "You approve every post. Change it any time.",
      options: ([7, 4, 3, 1] as const).map((n) => ({
        value: n,
        ...RHYTHM_LABELS[n],
        art: { kind: "calendar", days: n },
        recommended: n === recommended,
      })),
      columns: 2,
    },
    {
      kind: "channels",
      id: "channels",
      title: "Where do you **post**?",
      sub: "Pick yours. You connect them at the end, or later.",
    },
    {
      kind: "say",
      id: "story-learn",
      lines: fromSite
        ? ["From your link, Mox learns **what you sell**, **who buys it** and **how you sound**."]
        : [
            "From what you tell Mox, it learns **what you sell**, **who buys it** and **how you sound**.",
          ],
      pose: "pose-magnifier",
      side: "right",
    },
    {
      kind: "say",
      id: "story-plan",
      lines: ["Then Mox **plans, makes and schedules** your posts, ads and videos."],
      pose: "pose-calendar",
      side: "right",
    },
    {
      kind: "say",
      id: "story-approve",
      lines: [
        "Nothing goes out until **you approve it**.",
        "You stay in control, Mox does the work.",
      ],
      pose: "pose-relax",
      side: "right",
    },
    {
      kind: "pick",
      id: "approval",
      title: "When Autopilot runs, **who says yes**?",
      sub: "Autopilot starts with this. Change it any time.",
      options: APPROVAL_OPTIONS,
      columns: 3,
    },
    {
      kind: "pick",
      id: "tone",
      title: "What **tone** suits your brand?",
      options: TONE_OPTIONS,
      columns: 4,
    },
  ];
  if (a.tone) {
    screens.push({
      kind: "say",
      id: "tone-reaction",
      lines: [TONE_REACTION[a.tone]],
      pose: a.tone === "funny" ? "pose-jump" : "pose-thumbs",
      side: "right",
    });
  }
  screens.push(
    { kind: "pick", id: "emoji", title: "Now, **emoji**?", options: EMOJI_OPTIONS, columns: 4 },
    {
      kind: "pick",
      id: "length",
      title: "How **long** should captions be?",
      options: LENGTH_OPTIONS,
      columns: 4,
    },
    {
      kind: "swipe",
      id: "look",
      title: "Which posts feel like **you**?",
      sub: "Swipe right on the ones you love, left on the rest.",
    },
    {
      kind: "say",
      id: "look-learned",
      lines: [
        "Perfect. Mox **learns what you like** from every swipe, so posts keep getting better.",
      ],
      pose: "pose-thinking",
      side: "right",
    },
  );
  if (!ctx.sourceKnown) {
    screens.push({
      kind: "pick",
      id: "source",
      title: "Last one: where did you **hear about Mellox**?",
      options: SOURCE_OPTIONS,
      columns: 3,
    });
  }
  return screens;
}

/** The answer a pick screen holds, for showing it as chosen. */
export function answerFor(screen: PickScreen, a: Answers): string | number | undefined {
  return a[screen.id];
}

/** Every image id the questions use, so a test can check each one was made. */
export function questionArtIds(): string[] {
  const ids = new Set<string>();
  const all = [
    ...askScreens({ tone: "auto" }, { mode: "site", sourceKnown: false }),
    ...askScreens({ tone: "funny" }, { mode: "manual", sourceKnown: false }),
  ];
  for (const s of all) {
    if (s.kind === "pick") for (const o of s.options) if (o.art.kind === "image") ids.add(o.art.id);
    if (s.kind === "say" && s.pose.startsWith("pose-")) ids.add(s.pose);
  }
  return [...ids].sort();
}

/** Rough time left: about four seconds a screen. */
export function minutesLeft(remainingScreens: number): number {
  return Math.max(1, Math.round((remainingScreens * 4) / 60));
}
