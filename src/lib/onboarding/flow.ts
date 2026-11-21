// The onboarding flow (ADR-0035, ADR-0049): which step comes next, what a step
// needs before it may move on. One question per screen: the questions are one
// step ("ask") whose screens come from questions.ts, while the scan runs in the
// dock. It ends on "first" (press and hold to go in); no post is made during
// onboarding (Mellox 2.0). Pure and browser-safe; OnboardingPage only renders
// what this decides.

export type OnboardingStep =
  | "website"
  | "manual"
  | "ask"
  | "scan"
  | "review"
  | "audience"
  | "products"
  | "language"
  | "connect"
  | "first"
  | "done";

export type FlowMode = "site" | "manual";
export type ScanState = "idle" | "loading" | "ok" | "error";

export type FlowState = {
  mode: FlowMode;
  scan: ScanState;
  goalsSaved: boolean;
  activeProducts: number;
  /** Audience groups the scan offered; none skips the audience question. */
  audienceOptions: number;
};

export function nextStep(step: OnboardingStep, s: FlowState): OnboardingStep {
  switch (step) {
    case "website":
      return s.mode === "manual" ? "manual" : "ask";
    case "manual":
      return "ask";
    case "ask":
      if (s.mode === "manual") return "products";
      return s.scan === "ok" ? "review" : "scan";
    case "scan":
      return "review";
    case "review":
      return s.audienceOptions > 0 ? "audience" : "products";
    case "audience":
      return "products";
    case "products":
      return "language";
    case "language":
      return "connect";
    case "connect":
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
    case "ask":
      return s.mode === "manual" ? "manual" : "website";
    case "scan":
    case "review":
      return "ask";
    case "audience":
      return "review";
    case "products":
      if (s.mode === "manual") return "ask";
      return s.audienceOptions > 0 ? "audience" : "review";
    case "language":
      return "products";
    case "connect":
      return "language";
    case "first":
      return "connect";
    default:
      return null;
  }
}

/** Why this step can't move on yet, or null when it may. */
export function blockedReason(step: OnboardingStep, s: FlowState): string | null {
  if (step === "ask" && !s.goalsSaved) return "Choose what matters most first.";
  if (step === "products" && s.activeProducts < 1)
    return "Add at least one product or service so Mellox has something real to write about.";
  if (step === "scan" && s.scan !== "ok") return "Mellox is still reading your site.";
  return null;
}

export const canAdvance = (step: OnboardingStep, s: FlowState) => blockedReason(step, s) === null;

/** Steps after the questions, in order, for the progress line. */
const TAIL: OnboardingStep[] = ["review", "audience", "products", "language", "connect", "first"];

/**
 * How far along the person is, 0–1, for the one gradient line in the header.
 * The questions are most of the screens, so they carry most of the line.
 */
export function progressOf(
  step: OnboardingStep,
  ask: { index: number; count: number },
  mode: FlowMode,
): number {
  if (step === "done") return 1;
  if (step === "website" || step === "manual")
    return mode === "manual" && step === "manual" ? 0.06 : 0.03;
  if (step === "ask") return 0.06 + 0.64 * (ask.count ? Math.min(1, ask.index / ask.count) : 0);
  if (step === "scan") return 0.7;
  const i = TAIL.indexOf(step);
  return i < 0 ? 0.7 : 0.72 + (0.28 * i) / TAIL.length;
}

/** Screens still to come after this one, for "~N min left". */
export function screensLeft(
  step: OnboardingStep,
  ask: { index: number; count: number },
  s: FlowState,
): number {
  const tail = (s.mode === "site" ? 1 + (s.audienceOptions > 0 ? 1 : 0) : 0) + 4;
  if (step === "website" || step === "manual") return ask.count + tail;
  if (step === "ask") return Math.max(0, ask.count - ask.index - 1) + tail;
  const i = TAIL.indexOf(step);
  return i < 0 ? tail : Math.max(0, TAIL.length - i - 1);
}
