import { isNearDuplicateCopy } from "./studio/novelty";

type Draft = { channel?: string; kind?: string; body?: string };
type Planned = { channel: string; kind: string };

/** Check the complete set before any draft is inserted into Review. */
export function validContentBatch(args: {
  drafts: Draft[];
  count: number;
  channels: string[];
  plan?: Planned[];
  recentBodies: string[];
}): boolean {
  const { drafts, count, channels, plan, recentBodies } = args;
  if (drafts.length !== count) return false;
  return drafts.every((draft, index) => {
    const body = draft.body?.trim() ?? "";
    if (!body || !draft.channel || !channels.includes(draft.channel)) return false;
    if (plan && (draft.channel !== plan[index]?.channel || draft.kind !== plan[index]?.kind))
      return false;
    if (draft.kind === "blog" && body.split(/\s+/).length < 250) return false;
    return ![...recentBodies, ...drafts.slice(0, index).map((earlier) => earlier.body ?? "")].some(
      (other) => isNearDuplicateCopy(body, other),
    );
  });
}
