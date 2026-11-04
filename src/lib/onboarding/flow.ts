// The onboarding flow (ADR-0035): which step comes next, what a step needs
// before Continue. It ends on "first" (the finish: press and hold to go in);
// no post is made during onboarding (Mellox 2.0).
// Pure and browser-safe; OnboardingPage only renders what this decides.

export type OnboardingStep =
  | "website"
  | "manual"
  | "goals"
  | "scan"
  | "review"
  | "language"
  | "products"
  | "channels"
  | "first"
  | "done";

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
      if (s.mode === "manual") return "language";
      return s.scan === "ok" ? "review" : "scan";
    case "scan":
      return "review";
    case "review":
      return "language";
    case "language":
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
    case "language":
      return s.mode === "manual" ? "goals" : "review";
    case "products":
      return "language";
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
    { id: "language", label: "Language", covers: ["language"] },
    { id: "products", label: "Products", covers: ["products"] },
    { id: "channels", label: "Channels", covers: ["channels"] },
    { id: "first", label: "Ready", covers: ["first", "done"] },
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
