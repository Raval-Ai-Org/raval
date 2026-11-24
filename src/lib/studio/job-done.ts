// "Job done" posts (Round 9, flag `jobdone`): the person's own two photos of a
// real job, before and after, set side by side by code. Nothing is redrawn or
// generated, so the proof is the brand's own. The retired before/after kind
// stays retired: this only runs on two real photos the person gave.
// Pure: drawing is in src/server/studio/job-done.server.tsx.

const BEFORE_AFTER =
  /\bbefore\s*(?:and|&|\/|-|vs\.?)\s*after\b|\bbefore\b.{0,60}\bafter\b|\btransformation\b|\bjob done\b/i;

/** The brief asks to show a job's before and after. */
export function asksBeforeAfter(brief: string): boolean {
  return BEFORE_AFTER.test(brief);
}

/** The brief says the first photo is the after one ("after first", "second is the before"). */
export function afterComesFirst(brief: string): boolean {
  return /\b(?:first|1st)\s+(?:photo|picture|one|image)?\s*(?:is|=)\s*(?:the\s+)?after\b|\b(?:second|2nd|last)\s+(?:photo|picture|one|image)?\s*(?:is|=)\s*(?:the\s+)?before\b/i.test(
    brief,
  );
}

export type JobDoneLayout = { width: number; height: number; split: "side" | "stack" };

/** The canvas for the post's shape: tall posts stack the photos, wide and square sit side by side. */
export function jobDoneLayout(ratio: string | null | undefined): JobDoneLayout {
  if (ratio === "9:16") return { width: 1080, height: 1920, split: "stack" };
  if (ratio === "4:5") return { width: 1080, height: 1350, split: "stack" };
  if (ratio === "16:9") return { width: 1920, height: 1080, split: "side" };
  return { width: 1080, height: 1080, split: "side" };
}

/** Where each photo sits on the canvas, with a thin divider between them. */
export function jobDonePanels(layout: JobDoneLayout): {
  left: number;
  top: number;
  width: number;
  height: number;
}[] {
  const gap = Math.round(Math.min(layout.width, layout.height) * 0.008);
  if (layout.split === "side") {
    const w = Math.floor((layout.width - gap) / 2);
    return [
      { left: 0, top: 0, width: w, height: layout.height },
      { left: w + gap, top: 0, width: layout.width - w - gap, height: layout.height },
    ];
  }
  const h = Math.floor((layout.height - gap) / 2);
  return [
    { left: 0, top: 0, width: layout.width, height: h },
    { left: 0, top: h + gap, width: layout.width, height: layout.height - h - gap },
  ];
}
