// fields.ts — read an experiment field from a page's raw HTML, and decide
// whether a value is really on the page. Used by the live check and the
// contamination check; pure (the fetching is src/server/experiments/live-check.server.ts).
import { extractHtml, type RawExtraction } from "@/lib/geo/extract";
import type { ChangeType } from "./constants";
import type { FieldValue } from "./datafile";

export function normText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type PageFields = {
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  bodyText: string;
  faqJsonLd: boolean;
};

export function readFields(html: string): PageFields {
  const x: RawExtraction = extractHtml(html);
  return {
    title: x.titles[0] ?? null,
    meta_description: x.metaDescriptions[0] ?? null,
    h1: x.headings.find((h) => h.level === 1)?.text ?? null,
    bodyText: x.bodyText,
    faqJsonLd: x.jsonLd.some((j) => /"FAQPage"/.test(j)),
  };
}

/** The value a page currently shows for a field (text fields only). */
export function currentValue(fields: PageFields, field: ChangeType): string | null {
  switch (field) {
    case "title":
      return fields.title;
    case "meta_description":
      return fields.meta_description;
    case "h1":
      return fields.h1;
    default:
      return null;
  }
}

/** Is `value` what the page shows for `field`? Conservative: exact for head fields. */
export function showsValue(fields: PageFields, field: ChangeType, value: FieldValue): boolean {
  const body = normText(fields.bodyText);
  switch (field) {
    case "title":
    case "meta_description":
    case "h1": {
      const current = currentValue(fields, field);
      return current !== null && typeof value === "string" && normText(current) === normText(value);
    }
    case "intro":
    case "cta_text":
      return typeof value === "string" && body.includes(normText(value));
    case "faq":
      return (
        Array.isArray(value) &&
        fields.faqJsonLd &&
        value.every((item) => body.includes(normText(item.question)))
      );
  }
}

/** A control page counts as unchanged when its field still matches the recorded value. */
export function unchangedFrom(
  fields: PageFields,
  field: ChangeType,
  before: string | null,
): boolean | null {
  if (before === null) return null;
  const now = currentValue(fields, field);
  if (now !== null) return normText(now) === normText(before);
  return normText(fields.bodyText).includes(normText(before));
}
