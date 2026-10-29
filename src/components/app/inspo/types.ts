// What Inspo's presentational screen is given (ADR-0037). The panel fills it
// from the server; /inspo-lab fills it with sample data.

import type { BrandDna } from "@/hooks/use-brand-dna";
import type { BrandLookSpec } from "@/lib/brand-look/spec";
import type { VisualProfile, VisualSource } from "@/lib/brand-visuals/contracts";
import type { InspoCard, InspoChip } from "@/lib/inspo/board";
import type { InspoSection } from "@/lib/inspo/sections";

export type InspoUpload = { id: string; name: string; previewUrl: string | null; chip: InspoChip };

export type InspoTaste = {
  available: boolean;
  canEdit: boolean;
  sources: VisualSource[];
  /** The newest analysis waiting for a person, if any. */
  draft: { id: string; profile: VisualProfile } | null;
  /** The direction generators follow now. */
  active: { id: string; name: string } | null;
  running: { stage: string; pages: number } | null;
  lastError: string | null;
  /** Credits for the next analysis; 0 = included. */
  learnPrice: number;
};

export type InspoView = {
  dna: BrandDna;
  look: BrandLookSpec;
  cards: InspoCard[];
  taste: InspoTaste | null;
  uploads: InspoUpload[];
  busy: string | null;
  error: string | null;
  /** The card just removed, while Undo is still offered. */
  removed: InspoCard | null;
};

export type InspoHandlers = {
  onSection: (section: InspoSection) => void;
  saveLook: (next: BrandLookSpec) => void;
  resetLook: () => void;
  upload: (files: File[], chip: InspoChip) => void;
  addLink: (url: string, chip: InspoChip) => void;
  setChip: (card: InspoCard, chip: InspoChip) => void;
  remove: (card: InspoCard) => void;
  undo: () => void;
  learn: () => void;
  learnFromSite: () => void;
  pickDirection: (index: number) => void;
  useDirection: () => void;
  stopDirection: () => void;
  useInPost: (card: InspoCard) => void;
  openBrand: (tab?: string) => void;
  dismissError: () => void;
};
