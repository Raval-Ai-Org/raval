import "server-only";
// apply.server.ts — write approved CMS changes, and undo them.
//
//   apply   every field is re-read first; if any value changed since the
//           person approved (someone edited the page), nothing is written.
//           Fields are written in order; if one fails, the ones already
//           written are put back. Webflow page settings are then published.
//   undo    the reverse, refusing fields someone edited after Mellox.
//
// The values Mellox replaced are returned so the proposal row can keep them
// (cms_snapshot) for one-click undo.
import type { CmsChange } from "@/lib/geo/cms-fixes";
import { HttpError } from "@/server/http-error";
import {
  publishWebflowIfNeeded,
  readField,
  sameValue,
  writeField,
  type CmsSession,
} from "./access.server";

export class CmsDriftError extends HttpError {
  constructor(message: string) {
    super(409, message);
    this.name = "CmsDriftError";
  }
}

export type CmsSnapshotEntry = {
  index: number;
  /** What the field held just before Mellox wrote it. */
  value: string | boolean | null;
};

export type ApplyResult = { snapshot: CmsSnapshotEntry[]; published: boolean };

export async function applyCmsChanges(s: CmsSession, changes: CmsChange[]): Promise<ApplyResult> {
  if (!changes.length) throw new HttpError(409, "There is nothing to change.");
  const current = await Promise.all(changes.map((c) => readField(s, c)));
  changes.forEach((c, i) => {
    // null before = not readable through the API (Rank Math); nothing to compare.
    if (c.before !== null && current[i] !== null && !sameValue(current[i], c.before)) {
      throw new CmsDriftError(
        `${c.label} changed on your site since Mellox prepared this fix. Ask Mellox to prepare it again.`,
      );
    }
  });
  const written: CmsSnapshotEntry[] = [];
  try {
    for (let i = 0; i < changes.length; i++) {
      await writeField(s, changes[i], changes[i].after);
      written.push({ index: i, value: current[i] });
    }
  } catch (error) {
    for (const w of [...written].reverse()) {
      await writeField(s, changes[w.index], w.value).catch(() => null);
    }
    throw error;
  }
  const published = await publishWebflowIfNeeded(s, changes);
  return { snapshot: written, published };
}

export async function rollbackCmsChanges(
  s: CmsSession,
  changes: CmsChange[],
  snapshot: CmsSnapshotEntry[],
): Promise<{ restored: number; skipped: string[]; published: boolean }> {
  const skipped: string[] = [];
  let restored = 0;
  const reverted: CmsChange[] = [];
  for (const entry of [...snapshot].reverse()) {
    const change = changes[entry.index];
    if (!change) continue;
    const now = await readField(s, change);
    if (now !== null && !sameValue(now, change.after)) {
      skipped.push(change.label);
      continue;
    }
    await writeField(s, change, entry.value);
    reverted.push(change);
    restored++;
  }
  const published = await publishWebflowIfNeeded(s, reverted);
  return { restored, skipped, published };
}
