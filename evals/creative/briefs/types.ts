// Round 9 example briefs (ADR-0053). Study and benchmark data only: never
// bundled and never pasted into a prompt. A build script distils each brief's
// `mechanism` into src/server/studio/example-briefs.generated.ts, and only that
// one line ever reaches a writer. Ids are stored: add, never rename.
export type BriefGoal = "sell" | "lead" | "trust" | "launch" | "event" | "moment";
export type BriefFormat = "post" | "carousel" | "ad" | "story" | "video";
export type Awareness = "unaware" | "problem" | "solution" | "product" | "most";

export type ExampleBrief = {
  /** `<sector>-<nn>`, stable. */
  id: string;
  /** A sector id from src/lib/studio/sectors/kinds.generated.ts. */
  sector: string;
  goal: BriefGoal;
  format: BriefFormat;
  awareness: Awareness;
  /** WHAT the piece is (60-160 words): subject, offer, audience, the one point. Never camera or lighting. */
  brief: string;
  /** Why it sells, at most 140 characters, brand-neutral. The only text a writer ever sees. */
  mechanism: string;
  /** Words to fill from the brand's own facts, e.g. ["{price}", "{area}"]. Never invented. */
  placeholders: string[];
  /** Benchmark only: what a good result shows. */
  expect?: string;
  source: string;
  license: string;
};
