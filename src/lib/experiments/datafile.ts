// datafile.ts — the experiment data file a connected site reads (ADR-0024 §2).
//
// One file per repository, `mellox-experiments/overrides.json`, imported
// statically by a small reader module the one-time integration adds, so every
// bundler and host includes it. Each experiment owns one entry:
//
//   ship      entry with the treatment pages' new values
//   rollout   entry with every page of the group (the change becomes permanent)
//   rollback  entry removed
//
// Serialisation is deterministic (sorted keys, two-space indent, trailing
// newline), so the approved content hash is exact and review is a plain diff.
import type { ChangeType } from "./constants";
import { CHANGE_TYPES, DATA_FILE_DIR } from "./constants";

export const OVERRIDES_FILE = "overrides.json";
export const READER_FILE = "mellox/experiments.ts";
export const READER_MARKER = "melloxOverride(";

export type FaqItem = { question: string; answer: string };
export type FieldValue = string | FaqItem[];

export type ExperimentEntry = {
  field: ChangeType;
  pages: Record<string, FieldValue>;
};

export type OverridesFile = {
  version: 1;
  experiments: Record<string, ExperimentEntry>;
};

export const FIELD_LIMITS: Record<ChangeType, { min: number; max: number; label: string }> = {
  title: { min: 10, max: 70, label: "Page title" },
  meta_description: { min: 50, max: 170, label: "Meta description" },
  h1: { min: 5, max: 120, label: "Main heading" },
  intro: { min: 60, max: 700, label: "Intro paragraph" },
  faq: { min: 2, max: 6, label: "FAQ" },
  cta_text: { min: 2, max: 40, label: "Button text" },
};

export function emptyOverrides(): OverridesFile {
  return { version: 1, experiments: {} };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function serializeOverrides(file: OverridesFile): string {
  return `${JSON.stringify(sortKeys(file), null, 2)}\n`;
}

/** Parse the file on the base branch. A malformed file is refused, never overwritten. */
export function parseOverrides(
  text: string | null,
): { ok: true; file: OverridesFile } | { ok: false; reason: string } {
  if (text === null || !text.trim()) return { ok: true, file: emptyOverrides() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${DATA_FILE_DIR}/${OVERRIDES_FILE} isn't valid JSON.` };
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { version?: unknown }).version !== 1 ||
    typeof (raw as { experiments?: unknown }).experiments !== "object"
  ) {
    return { ok: false, reason: `${DATA_FILE_DIR}/${OVERRIDES_FILE} has an unknown format.` };
  }
  const experiments: Record<string, ExperimentEntry> = {};
  for (const [id, entry] of Object.entries((raw as OverridesFile).experiments ?? {})) {
    if (
      !entry ||
      !CHANGE_TYPES.includes(entry.field) ||
      !entry.pages ||
      typeof entry.pages !== "object"
    ) {
      return { ok: false, reason: `Entry ${id} in ${OVERRIDES_FILE} is malformed.` };
    }
    experiments[id] = { field: entry.field, pages: { ...entry.pages } };
  }
  return { ok: true, file: { version: 1, experiments } };
}

/** The file after setting (or, with null, removing) one experiment's entry. */
export function withEntry(
  current: OverridesFile,
  experimentId: string,
  entry: ExperimentEntry | null,
): OverridesFile {
  const experiments = { ...current.experiments };
  if (entry) experiments[experimentId] = entry;
  else delete experiments[experimentId];
  return { version: 1, experiments };
}

/** Paths claimed by other experiments' entries (a page may carry one override per field). */
export function conflictingPaths(
  current: OverridesFile,
  experimentId: string,
  entry: ExperimentEntry,
): string[] {
  const out: string[] = [];
  for (const [id, other] of Object.entries(current.experiments)) {
    if (id === experimentId || other.field !== entry.field) continue;
    for (const path of Object.keys(entry.pages)) if (path in other.pages) out.push(path);
  }
  return out.sort();
}

/* ───────────────────────── value checks ───────────────────────── */

export function parseFieldValue(field: ChangeType, raw: string): FieldValue | null {
  if (field !== "faq") return raw;
  try {
    const items = JSON.parse(raw) as FaqItem[];
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

export function stringifyFieldValue(value: FieldValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Plain-language problems with a proposed value, or []. */
export function checkFieldValue(field: ChangeType, value: FieldValue): string[] {
  const limits = FIELD_LIMITS[field];
  const problems: string[] = [];
  if (field === "faq") {
    if (!Array.isArray(value)) return ["The FAQ must be a list of questions and answers."];
    if (value.length < limits.min || value.length > limits.max)
      problems.push(`An FAQ needs ${limits.min}–${limits.max} questions.`);
    for (const item of value) {
      if (!item?.question?.trim() || !item?.answer?.trim())
        problems.push("Every FAQ item needs a question and an answer.");
      else if (item.question.length > 200 || item.answer.length > 600)
        problems.push("An FAQ question or answer is too long.");
    }
    return [...new Set(problems)];
  }
  if (typeof value !== "string") return [`${limits.label} must be text.`];
  const text = value.trim();
  if (text !== value) problems.push(`${limits.label} has extra spaces at the start or end.`);
  if (text.length < limits.min || text.length > limits.max)
    problems.push(`${limits.label} must be ${limits.min}–${limits.max} characters.`);
  if (/[<>]/.test(text)) problems.push(`${limits.label} can't contain HTML.`);
  if (/\n/.test(text) && field !== "intro") problems.push(`${limits.label} must be one line.`);
  return problems;
}

/* ───────────────────────── reader module ───────────────────────── */

/** Where the integration puts the reader and the data file, relative to the app root. */
export function integrationPaths(appRoot: string, usesSrc: boolean) {
  const root = appRoot ? `${appRoot.replace(/\/+$/, "")}/` : "";
  const reader = `${root}${usesSrc ? "src/" : ""}${READER_FILE}`;
  const dataFile = `${root}${DATA_FILE_DIR}/${OVERRIDES_FILE}`;
  const depth = reader.split("/").length - 1 - (root ? root.split("/").length - 1 : 0);
  const importPath = `${"../".repeat(depth)}${DATA_FILE_DIR}/${OVERRIDES_FILE}`;
  return { reader, dataFile, importPath };
}

/** The reader module: deterministic, dependency-free, safe when the file is empty. */
export function readerModuleSource(importPath: string): string {
  return `// Generated by Mellox Proof Engine. Do not edit by hand.
//
// Pages call melloxOverride(pathname, field) and fall back to their own value
// when it returns undefined. Values come from ${DATA_FILE_DIR}/${OVERRIDES_FILE},
// which Mellox updates only through pull requests you approve and merge.
import data from "${importPath}";

export type MelloxFaq = { question: string; answer: string }[];
export type MelloxField = "title" | "meta_description" | "h1" | "intro" | "faq" | "cta_text";
type Value = string | MelloxFaq;
type File = { version: number; experiments: Record<string, { field: string; pages: Record<string, Value> }> };

function normalize(pathname: string): string {
  let p = (pathname || "/").split(/[?#]/)[0];
  if (!p.startsWith("/")) p = "/" + p;
  try {
    p = decodeURI(p);
  } catch {
    // keep as given
  }
  p = p.replace(/\\/{2,}/g, "/");
  return p.length > 1 ? p.replace(/\\/+$/, "") : p;
}

const table = new Map<string, Value>();
for (const entry of Object.values((data as File).experiments ?? {})) {
  for (const [path, value] of Object.entries(entry.pages ?? {})) {
    table.set(entry.field + " " + normalize(path), value);
  }
}

export function melloxOverride(pathname: string, field: "faq"): MelloxFaq | undefined;
export function melloxOverride(
  pathname: string,
  field: Exclude<MelloxField, "faq">,
): string | undefined;
export function melloxOverride(pathname: string, field: MelloxField): Value | undefined {
  return table.get(field + " " + normalize(pathname));
}
`;
}
