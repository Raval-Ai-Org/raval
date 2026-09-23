// Generated copy should read like a person wrote it. Em dashes are the most
// recognisable tell of machine-written marketing copy, so they never ship:
// the prompt forbids them and this pass removes any that slip through.
// Pure: runs on the server before drafts are saved, and is unit-tested.
//
// humanizeText/humanizeDeep live in src/lib/ai/humanize-text.ts (shared with
// the AI gateways, so every generation surface gets this, not just Studio) —
// re-exported here so existing imports of this module keep working.
import { humanizeDeep, humanizeText } from "@/lib/ai/humanize-text";
import type { StudioJobOutput } from "./jobs";

export { humanizeText };

/** Every user-facing string in a job's output, with character counts kept honest. */
export function humanizeOutput(output: StudioJobOutput): StudioJobOutput {
  const next = humanizeDeep(output);
  if (next.variants) next.variants = next.variants.map((v) => ({ ...v, chars: v.body.length }));
  return next;
}
