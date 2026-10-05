// What exactly gets scored for a saved piece of content. Pure.
//
// The text is read from the row, never from the browser, so a score always
// belongs to what is really saved.
import { studioTypeFromContent } from "@/lib/studio/formats";
import type { Subject, SubjectKind } from "./contracts";

export type ContentLike = {
  kind: string | null;
  channel: string | null;
  title: string | null;
  body: string | null;
  meta: unknown;
};

/** Formats the quick score follows a generation for. */
export const AUTO_SCORE_TYPES: readonly string[] = ["social", "image", "ad", "script", "carousel"];

/** Formats a person can ask a score for. Articles and Stories are not scored yet. */
export const SCORABLE_TYPES: readonly string[] = [...AUTO_SCORE_TYPES, "video"];

const KIND_FOR: Record<string, SubjectKind> = {
  social: "post",
  image: "post",
  video: "post",
  carousel: "carousel",
  ad: "ad",
  script: "script",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function carouselText(meta: Record<string, unknown>, caption: string): string {
  const slides = Array.isArray(meta.slides) ? meta.slides : [];
  const lines = slides.slice(0, 12).map((slide, i) => {
    const s = record(slide);
    return `Slide ${i + 1}: ${[str(s.heading), str(s.body)].filter(Boolean).join(" — ")}`;
  });
  return [...lines, caption && `Caption: ${caption}`].filter(Boolean).join("\n");
}

function scriptText(meta: Record<string, unknown>, fallback: string): string {
  const script = record(meta.script);
  const beats = Array.isArray(script.beats) ? script.beats : [];
  if (!str(script.hook) && !beats.length) return fallback;
  return [
    str(script.hook) && `Opening: ${str(script.hook)}`,
    ...beats.slice(0, 10).map((beat) => str(record(beat).voiceover)),
    str(script.cta) && `Ending: ${str(script.cta)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function adText(meta: Record<string, unknown>, fallback: string): string {
  const first = record(Array.isArray(meta.ad_variants) ? meta.ad_variants[0] : null);
  if (!str(first.primaryText) && !str(first.headline)) return fallback;
  return [
    str(first.headline) && `Headline: ${str(first.headline)}`,
    str(first.primaryText),
    str(first.cta) && `Button: ${str(first.cta)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function subjectFromContent(
  item: ContentLike,
): { subject: Subject; contentType: string } | null {
  const meta = record(item.meta);
  const type = studioTypeFromContent(item.kind, meta);
  if (type === "legacy" || !SCORABLE_TYPES.includes(type)) return null;
  const caption = str(item.body);
  let body = caption;
  if (type === "carousel") body = carouselText(meta, caption);
  else if (type === "script") body = scriptText(meta, caption);
  else if (type === "ad") body = adText(meta, caption);
  body = body.slice(0, 6000).trim();
  if (!body) return null;
  return {
    subject: {
      kind: KIND_FOR[type] ?? "post",
      platform: str(meta.platform) || str(item.channel),
      title: str(item.title).slice(0, 300),
      body,
    },
    contentType: type,
  };
}
