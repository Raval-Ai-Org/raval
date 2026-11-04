import type { Agent } from "./agents";
import type { MoxMood } from "@/components/brand/mox/MoxFace";

export interface MoodState {
  mood: MoxMood;
  intensity: number; // 0..1 — drives halo brightness
  progress: number; // 0..100
}

/**
 * Derive an agent's Mox mood from runtime signals.
 * Maps the runtime lifecycle to Mox's faces.
 */
export function deriveMood(
  _agent: Agent,
  opts: {
    active: boolean;
    progress: number | null;
    hasCurrent: boolean;
    recentlyCompleted: boolean;
    justDeployed: boolean;
  },
): MoodState {
  const { active, progress, hasCurrent, recentlyCompleted, justDeployed } = opts;
  const p = progress ?? 0;

  if (justDeployed) return { mood: "excited", intensity: 0.7, progress: p };
  if (recentlyCompleted) return { mood: "excited", intensity: 1, progress: 100 };
  if (!active) return { mood: "happy", intensity: 0.15, progress: 0 };
  if (active && !hasCurrent) return { mood: "happy", intensity: 0.55, progress: 0 };

  if (p < 35) return { mood: "scanning", intensity: 0.4 + p / 200, progress: p };
  if (p < 80) return { mood: "thinking", intensity: 0.55 + (p - 35) / 200, progress: p };
  return { mood: "excited", intensity: 0.85 + (p - 80) / 300, progress: p };
}
