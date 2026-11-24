// The shape of one Round 9 sector playbook (ADR-0053). Researched with
// sources in docs/studio/research-2026-11/; brand-neutral.
import type { IndustryId } from "@/lib/studio/knowledge/industries";
import type { BusinessKind } from "@/lib/studio/sectors/kinds";

export type SectorPlaybook = {
  id: string;
  label: string;
  kind: BusinessKind;
  parent: IndustryId;
  /** Lowercase terms matched against the industry line, then the brand text. */
  match: string[];
  /** What the picture shows when there is no product (the real work). */
  show: string;
  /** Proof a business of this kind can really hold. */
  proof: string[];
  wants: string;
  doubts: string;
  /** What rings false for this business (at most 3). */
  cliches: string[];
  angles: string[];
  carousels: string[];
  videoArc: string;
  typeVoices: string[];
  moments: string[];
  /** Advertising rules that bind this sector. */
  regulated?: string;
};
