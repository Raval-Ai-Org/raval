// A plan changed after the campaign started: which Autopilot steps to add,
// which to remove, which to leave alone. A step that has started making its
// piece (or anything later) is never touched — what was made, approved or
// scheduled stays exactly as it is; the person changes it on the calendar or
// in review. Only steps that haven't made anything are replaced.
// Pure: no I/O.
import type { ActionStatus } from "@/lib/autopilot/contracts";
import type { CampaignPiece } from "./contracts";
import { UNMADE } from "./progress";

export type CampaignStep = {
  id: string;
  status: ActionStatus;
  /** result.campaign.pieceId and result.campaign.sig as stored. */
  pieceId: string | null;
  sig: string | null;
};

/** What a stored step must still match for it to stay. */
export function pieceSignature(piece: CampaignPiece): string {
  return [
    piece.date,
    piece.time,
    piece.platform,
    piece.format,
    piece.aim,
    piece.hook,
    piece.storyTheme ?? "",
    piece.title,
    piece.idea,
    piece.visual,
    piece.mediaMode,
    piece.mediaIds.join(","),
  ].join("|");
}

export type PieceDiff = {
  insert: CampaignPiece[];
  cancel: string[];
  /** Pieces whose step already made something: shown as they are. */
  locked: string[];
};

const DONE_WITH: readonly ActionStatus[] = ["cancelled", "rejected", "failed", "skipped", "missed"];

export function diffPieces(
  pieces: readonly CampaignPiece[],
  steps: readonly CampaignStep[],
  sigOf: (piece: CampaignPiece) => string = pieceSignature,
): PieceDiff {
  const live = steps.filter((s) => !DONE_WITH.includes(s.status));
  const byPiece = new Map<string, CampaignStep[]>();
  for (const step of live) {
    if (!step.pieceId) continue;
    byPiece.set(step.pieceId, [...(byPiece.get(step.pieceId) ?? []), step]);
  }
  const wanted = new Set(pieces.map((p) => p.id));
  const insert: CampaignPiece[] = [];
  const cancel: string[] = [];
  const locked: string[] = [];

  for (const piece of pieces) {
    const existing = byPiece.get(piece.id) ?? [];
    const made = existing.find((s) => !UNMADE.includes(s.status));
    if (made) {
      locked.push(piece.id);
      // A made piece wins; an unmade duplicate beside it goes.
      for (const s of existing) if (s !== made && UNMADE.includes(s.status)) cancel.push(s.id);
      continue;
    }
    const sig = sigOf(piece);
    const same = existing.find((s) => s.sig === sig);
    for (const s of existing) if (s !== same) cancel.push(s.id);
    if (!same) insert.push(piece);
  }
  for (const step of live) {
    if (step.pieceId && !wanted.has(step.pieceId) && UNMADE.includes(step.status))
      cancel.push(step.id);
  }
  return { insert, cancel: [...new Set(cancel)], locked };
}
