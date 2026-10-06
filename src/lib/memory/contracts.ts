// Memory (ADR-0033): what a brand's team has told Mellox to remember.
// Browser-safe types and limits shared by the server, chat and the UI.
import { z } from "zod";

export const MEMORY_KINDS = ["rule", "preference", "fact", "context"] as const;
export const MEMORY_TOPICS = [
  "visual",
  "voice",
  "content",
  "audience",
  "business",
  "other",
] as const;
export const MEMORY_SOURCES = ["chat", "manual", "import"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryTopic = (typeof MEMORY_TOPICS)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_MIN_CHARS = 3;
export const MEMORY_MAX_CHARS = 500;
/** Active memories one brand can hold. */
export const MEMORY_LIMIT = 200;
/** A temporary memory lasts between an hour and a week; a day unless said otherwise. */
export const TEMP_MIN_HOURS = 1;
export const TEMP_MAX_HOURS = 168;
export const TEMP_DEFAULT_HOURS = 24;
/** Changes one chat reply may make. */
export const MAX_OPS_PER_TURN = 5;

export type Memory = {
  id: string;
  body: string;
  kind: MemoryKind;
  topic: MemoryTopic;
  source: MemorySource;
  /** null = kept until removed. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A stored row as the rules see it: removed ones included, to stop re-learning. */
export type StoredMemory = Memory & { status: "active" | "removed"; fingerprint: string };

export const MemoryBodySchema = z.string().trim().min(MEMORY_MIN_CHARS).max(MEMORY_MAX_CHARS);

/** What a model (or the background reader) may propose. Pure code decides. */
export type MemoryOp =
  | {
      op: "add";
      text: string;
      kind?: string;
      topic?: string;
      /** "hours" makes it temporary. */
      lasts?: string;
      hours?: number;
    }
  | { op: "update"; id: string; text: string }
  | { op: "remove"; id: string };

/** What actually happened, for the "Memory updated" note under a reply. */
export type MemoryChange = {
  op: "added" | "updated" | "removed";
  id: string;
  text: string;
  temporary?: boolean;
};

export type MemoryView = {
  /** The brand's own switch. */
  enabled: boolean;
  /** Editors add, edit and remove. */
  canEdit: boolean;
  /** Admins switch memory off and clear it. */
  canManage: boolean;
  memories: Memory[];
  limit: number;
};
