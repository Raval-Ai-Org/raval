// The weekly summary email. Pure: counts in, a subject and a few plain lines
// out. Every number is one Mellox already holds; nothing is estimated.

export type WeekReportInput = {
  brand: string;
  posted: { title: string; views: number }[];
  /** Pieces waiting for a person's OK. */
  waiting: number;
  /** New ideas from the market and competitors. */
  ideas: number;
  /** Steps that did not work this week. */
  failed: number;
  /** Planned for the coming seven days. */
  comingUp: number;
  visibilityScore: number | null;
  learnings: string[];
  /** Contacts added in the brand's CRM since its goal started (measured, ADR-0042). */
  leads?: { value: number; source: string } | null;
  /** Community threads found this week where people ask about the brand's field. */
  communityThreads?: number;
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Null when there is nothing worth an email. */
export function weeklyReport(input: WeekReportInput): { subject: string; text: string } | null {
  const { posted } = input;
  const threads = input.communityThreads ?? 0;
  if (
    !posted.length &&
    !input.waiting &&
    !input.comingUp &&
    !input.ideas &&
    !input.failed &&
    !threads &&
    !input.leads
  ) {
    return null;
  }
  const views = posted.reduce((sum, p) => sum + Math.max(0, p.views), 0);
  const best = [...posted].sort((a, b) => b.views - a.views)[0];
  const lines: string[] = [];

  lines.push(
    posted.length
      ? `${n(posted.length, "post")} went out for ${input.brand} this week${
          views ? `, seen ${views.toLocaleString("en-US")} times so far` : ""
        }.`
      : `Nothing went out for ${input.brand} this week.`,
  );
  if (best && best.views > 0) {
    lines.push(`Best: "${best.title}" (${best.views.toLocaleString("en-US")} views).`);
  }
  const todo = [
    input.waiting ? `${n(input.waiting, "post")} waiting for your OK` : "",
    input.failed ? `${n(input.failed, "step")} that didn't work` : "",
    input.ideas ? n(input.ideas, "new idea") : "",
  ].filter(Boolean);
  if (todo.length) lines.push(`For you: ${todo.join(", ")}.`);
  if (input.comingUp) lines.push(`Coming up: ${n(input.comingUp, "post")} in the next 7 days.`);
  if (input.leads) {
    lines.push(
      `New contacts in ${input.leads.source} since your goal started: ${input.leads.value.toLocaleString("en-US")}.`,
    );
  }
  if (threads) {
    lines.push(
      `Communities: ${n(threads, "new thread")} where people ask about your field. Reply ideas are in Brain → Market.`,
    );
  }
  if (input.visibilityScore !== null) {
    lines.push(`AI visibility score: ${input.visibilityScore} out of 100.`);
  }
  if (input.learnings.length) {
    lines.push(
      ["What Mellox learned:", ...input.learnings.slice(0, 3).map((l) => `• ${l}`)].join("\n"),
    );
  }
  return {
    subject: posted.length
      ? `Your week on Autopilot: ${n(posted.length, "post")} out`
      : "Your week on Autopilot",
    text: lines.join("\n\n"),
  };
}
