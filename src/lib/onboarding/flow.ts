// The onboarding flow (ADR-0035): which step comes next, what a step needs
// before Continue, and the three first posts a person can make at the end.
// Pure and browser-safe; OnboardingPage only renders what this decides.
import type { PlatformId } from "@/lib/social-platforms";
import type { ShareAimId } from "@/lib/studio/viral";
import { SHARE_AIMS } from "@/lib/studio/viral";
import type { GoalFocus, WorkspaceGoals } from "@/lib/goals/contracts";
import { goalLine } from "@/lib/goals/decide";
import type { Product } from "@/lib/products/catalog";

export type OnboardingStep =
  "website" | "manual" | "goals" | "scan" | "review" | "products" | "channels" | "first" | "done";

export type FlowMode = "site" | "manual";
export type ScanState = "idle" | "loading" | "ok" | "error";

export type FlowState = {
  mode: FlowMode;
  scan: ScanState;
  goalsSaved: boolean;
  activeProducts: number;
};

export function nextStep(step: OnboardingStep, s: FlowState): OnboardingStep {
  switch (step) {
    case "website":
      return s.mode === "manual" ? "manual" : "goals";
    case "manual":
      return "goals";
    case "goals":
      if (s.mode === "manual") return "products";
      return s.scan === "ok" ? "review" : "scan";
    case "scan":
      return "review";
    case "review":
      return "products";
    case "products":
      return "channels";
    case "channels":
      return "first";
    case "first":
    case "done":
      return "done";
  }
}

export function previousStep(step: OnboardingStep, s: FlowState): OnboardingStep | null {
  switch (step) {
    case "manual":
      return "website";
    case "goals":
      return s.mode === "manual" ? "manual" : "website";
    case "scan":
    case "review":
      return "goals";
    case "products":
      return s.mode === "manual" ? "goals" : "review";
    case "channels":
      return "products";
    case "first":
      return "channels";
    default:
      return null;
  }
}

/** Why Continue is disabled on this step, or null when it may advance. */
export function blockedReason(step: OnboardingStep, s: FlowState): string | null {
  if (step === "goals" && !s.goalsSaved) return "Choose what matters most first.";
  if (step === "products" && s.activeProducts < 1)
    return "Add at least one product or service so Mellox has something real to write about.";
  if (step === "scan" && s.scan !== "ok") return "Mellox is still reading your site.";
  return null;
}

export const canAdvance = (step: OnboardingStep, s: FlowState) => blockedReason(step, s) === null;

export type IndicatorStep = { id: string; label: string; covers: OnboardingStep[] };

/** The numbered steps in the header. The scan sits under "Your goal" (it runs meanwhile). */
export function indicatorSteps(mode: FlowMode): IndicatorStep[] {
  const tail: IndicatorStep[] = [
    { id: "products", label: "Products", covers: ["products"] },
    { id: "channels", label: "Channels", covers: ["channels"] },
    { id: "first", label: "First posts", covers: ["first", "done"] },
  ];
  return mode === "manual"
    ? [
        { id: "brand", label: "Brand", covers: ["website", "manual"] },
        { id: "goals", label: "Your goal", covers: ["goals"] },
        ...tail,
      ]
    : [
        { id: "website", label: "Website", covers: ["website"] },
        { id: "goals", label: "Your goal", covers: ["goals", "scan"] },
        { id: "review", label: "Brand DNA", covers: ["review"] },
        ...tail,
      ];
}

export function indicatorIndex(mode: FlowMode, step: OnboardingStep): number {
  if (step === "done") return indicatorSteps(mode).length;
  return indicatorSteps(mode).findIndex((s) => s.covers.includes(step));
}

// ── First posts ────────────────────────────────────────────────────────────

const FIRST_AIMS: Record<GoalFocus, [ShareAimId, ShareAimId, ShareAimId]> = {
  followers: ["send", "save", "relate"],
  reach: ["send", "relate", "save"],
  engagement: ["reply", "relate", "send"],
  leads: ["save", "act", "send"],
  sales: ["act", "save", "relate"],
  launch: ["act", "send", "reply"],
};

const STUDIO_GOAL: Record<GoalFocus, "awareness" | "engagement" | "leads" | "launch" | "offer"> = {
  followers: "awareness",
  reach: "awareness",
  engagement: "engagement",
  leads: "leads",
  sales: "offer",
  launch: "launch",
};

/** Platforms where a post is a picture first, so the first post gets one. */
const VISUAL_FIRST = new Set<PlatformId>(["instagram", "tiktok", "youtube", "facebook"]);

export type FirstPostBrief = {
  n: 1 | 2 | 3;
  aim: ShareAimId;
  aimLabel: string;
  platform: PlatformId;
  /** The Studio job body (without `brand`, which the browser adds). */
  job: {
    workspaceId: string;
    type: "social";
    idempotencyKey: string;
    intent: {
      brief: string;
      goal: (typeof STUDIO_GOAL)[GoalFocus];
      aim: ShareAimId;
      ideaSource: "onboarding";
    };
    controls: {
      platforms: PlatformId[];
      includeImage: boolean;
      productId: string;
      referenceAssetIds?: string[];
      referenceMode?: "preserve";
    };
  };
};

/** The key a first post is created with: the same on every retry or refresh. */
export const firstPostKey = (workspaceId: string, n: number) =>
  `onboarding-first:${workspaceId}:${n}`;

export function firstPostPlatform(goals: WorkspaceGoals | null, connected: string[]): PlatformId {
  const wanted = goals?.channels ?? [];
  const pick =
    wanted.find((c) => connected.includes(c)) ??
    wanted[0] ??
    (connected[0] as PlatformId | undefined);
  return (pick as PlatformId | undefined) ?? "instagram";
}

/**
 * Three first posts, each with a different job (save / send / reply / act…)
 * chosen for the goal, all about one real product, on the person's main
 * channel. A product with a photo keeps that exact photo ("preserve").
 */
export function firstPostBriefs(args: {
  workspaceId: string;
  brandName: string;
  goals: WorkspaceGoals | null;
  product: Pick<Product, "id" | "kind" | "name" | "primaryAssetId">;
  platform: PlatformId;
}): FirstPostBrief[] {
  const { workspaceId, brandName, goals, product, platform } = args;
  const focus: GoalFocus = goals?.focus ?? "reach";
  const aims = FIRST_AIMS[focus];
  const photo = product.kind === "product" ? product.primaryAssetId : null;
  const goalText = goals ? goalLine(goals) : "";
  return aims.map((aimId, i) => {
    const aim = SHARE_AIMS.find((a) => a.id === aimId)!;
    const n = (i + 1) as 1 | 2 | 3;
    const brief = [
      `One of ${brandName || "the brand"}'s first posts on Mellox, about ${product.name}.`,
      `Its job: ${aim.label.toLowerCase()}. ${aim.directive}`,
      goalText ? `It works toward the brand's goal: ${goalText}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1200);
    return {
      n,
      aim: aimId,
      aimLabel: aim.label,
      platform,
      job: {
        workspaceId,
        type: "social",
        idempotencyKey: firstPostKey(workspaceId, n),
        intent: { brief, goal: STUDIO_GOAL[focus], aim: aimId, ideaSource: "onboarding" },
        controls: {
          platforms: [platform],
          includeImage: Boolean(photo) || VISUAL_FIRST.has(platform),
          productId: product.id,
          ...(photo ? { referenceAssetIds: [photo], referenceMode: "preserve" as const } : {}),
        },
      },
    };
  });
}
