// Written by scripts/generate-onboarding-art.mjs: the 3D Mox pictures at
// public/brand/mox/onboarding/<id>.webp. Don't edit by hand.

export const ONBOARDING_ART_IDS = [
  "goal-engagement",
  "goal-followers",
  "goal-launch",
  "goal-leads",
  "goal-reach",
  "goal-sales",
  "pose-calendar",
  "pose-jump",
  "pose-magnifier",
  "pose-relax",
  "pose-thinking",
  "pose-thumbs",
  "role-agency",
  "role-creator",
  "role-owner",
  "role-team",
  "team-mini",
  "tone-casual",
  "tone-corporate",
  "tone-funny",
  "tone-personal",
  "world-day",
  "world-finish",
] as const;

export type OnboardingArtId = (typeof ONBOARDING_ART_IDS)[number];

const ON_DISK: ReadonlySet<string> = new Set(ONBOARDING_ART_IDS);

/** The picture's URL, or null when it hasn't been made (callers fall back to a Mox render). */
export function onboardingArt(id: string | undefined | null): string | null {
  return id && ON_DISK.has(id) ? `/brand/mox/onboarding/${id}.webp` : null;
}
