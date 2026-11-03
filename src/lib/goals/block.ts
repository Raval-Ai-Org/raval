// The goal block a generator reads (ADR-0035). Pure.
import { FOCUS_LABELS, type WorkspaceGoals } from "./contracts";
import { goalLine, platformLabel, targetLine } from "./decide";

export function goalBlock(goals: WorkspaceGoals): string {
  const channels = goals.channels.map((c) => platformLabel(c)).join(", ");
  return [
    "## The brand's goal (set by the team)",
    `- ${goalLine(goals)}`,
    ...goals.targets.slice(1).map((t) => `- Also: ${targetLine(t)}`),
    `- Plan: ${goals.postsPerWeek} post${goals.postsPerWeek === 1 ? "" : "s"} a week${channels ? ` on ${channels}` : ""}`,
    goals.note ? `- In their words: ${goals.note}` : "",
    `Write every piece to move this goal (${FOCUS_LABELS[goals.focus].hint.toLowerCase()}). Never promise results and never quote these targets in the post itself.`,
  ]
    .filter(Boolean)
    .join("\n");
}
