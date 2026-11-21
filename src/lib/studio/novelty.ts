import type { StudioContext } from "./prompts";
import type { StudioJobOutput } from "./jobs";
import type { StudioType } from "./formats";
import { openingLine } from "./memory";

function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2);
}

function shingles(value: string): Set<string> {
  const words = tokens(value);
  const size = words.length >= 9 ? 3 : 2;
  const result = new Set<string>();
  for (let i = 0; i <= words.length - size; i++) result.add(words.slice(i, i + size).join(" "));
  return result;
}

function similarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return common / Math.min(left.size, right.size);
}

/** Shared by Studio and the Command Center's simpler text generator. */
export function isNearDuplicateCopy(a: string, b: string): boolean {
  return tokens(a).length >= 8 && tokens(b).length >= 8 && similarity(a, b) >= 0.78;
}

export function outputSubstance(output: StudioJobOutput): string {
  if (output.article) return output.article.markdown;
  if (output.story?.frames.length)
    return output.story.frames.map((f) => `${f.heading} ${f.body}`).join(" ");
  if (output.slides) return output.slides.map((s) => `${s.heading} ${s.body}`).join(" ");
  if (output.script)
    return [output.script.hook, ...output.script.beats.map((b) => b.voiceover)].join(" ");
  if (output.ads) return output.ads.map((a) => `${a.headline} ${a.primaryText}`).join(" ");
  if (output.concept) return output.concept;
  return output.variants?.map((v) => v.body.replace(/#[\p{L}\p{N}_]+/gu, "")).join(" ") ?? "";
}

/** Catch a repeated idea or passage before drafts and expensive media renders are saved. */
export function findSimilarRecent(
  type: StudioType,
  output: StudioJobOutput,
  recent: StudioContext["recent"],
): { title: string; score: number } | null {
  const body = outputSubstance(output);
  if (tokens(body).length < 8) return null;
  for (const item of recent) {
    if (item.type !== type || !item.excerpt) continue;
    const score = similarity(body, item.excerpt);
    const titleScore = output.title ? similarity(output.title, item.title) : 0;
    if (score >= 0.78 || (score >= 0.58 && titleScore >= 0.8)) {
      return { title: item.title, score };
    }
  }
  return null;
}

/** The first thing a reader sees in this output. */
export function outputOpening(output: StudioJobOutput): string {
  if (output.slides?.length) return output.slides[0].heading;
  if (output.story?.frames.length) return output.story.frames[0].heading;
  if (output.script) return output.script.hook;
  if (output.ads?.length) return output.ads[0].headline;
  if (output.article) return output.article.title;
  return openingLine(output.variants?.[0]?.body);
}

/**
 * Catch an opening the workspace has already used, in any format. A new idea
 * that starts the same way still reads as a repeat on the profile.
 */
export function findRepeatedOpening(
  output: StudioJobOutput,
  recent: StudioContext["recent"],
): { title: string; opening: string } | null {
  const openings = [
    outputOpening(output),
    ...(output.variants ?? []).map((v) => openingLine(v.body)),
  ].filter((o) => tokens(o).length >= 4);
  for (const opening of openings) {
    for (const item of recent) {
      if (!item.hook || tokens(item.hook).length < 4) continue;
      const same = opening.trim().toLowerCase() === item.hook.trim().toLowerCase();
      if (same || similarity(opening, item.hook) >= 0.75)
        return { title: item.title, opening: item.hook };
    }
  }
  return null;
}

/** One form for a link, so "https://www.x.com/a/." and "http://x.com/a" match. */
function normalizeUrl(url: string): string {
  return url
    .trim()
    .replace(/[.,;:!?'"]+$/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .replace(/^https?:\/\/(www\.)?/i, "")
    .toLowerCase();
}

/** A researched article must visibly point readers to at least one supplied source. */
export function hasResearchCitation(markdown: string, sourceUrls: string[]): boolean {
  if (!sourceUrls.length) return true;
  const allowed = new Set(sourceUrls.map(normalizeUrl));
  const links = markdown.match(/https?:\/\/[^\s)\]>]+/gi) ?? [];
  return links.some((url) => allowed.has(normalizeUrl(url)));
}

/**
 * The last resort for a researched article that forgot to link its sources:
 * list the sources the research really returned under the article, rather
 * than failing a draft that is otherwise fine. Only supplied links are used.
 */
export function withResearchSources(
  markdown: string,
  sources: { title: string; url: string }[],
): string {
  const lines = sources
    .filter((s) => /^https:\/\//i.test(s.url))
    .slice(0, 5)
    .map((s) => `- [${(s.title || s.url).replace(/[[\]]/g, "").trim()}](${s.url})`);
  if (!lines.length) return markdown;
  return `${markdown.trimEnd()}\n\n## Sources\n\n${lines.join("\n")}\n`;
}

/**
 * The joke a piece told: a meme's lines, else the words set on the picture.
 * Stored on the post (meta.joke) so no later post tells it again.
 */
export function outputJoke(output: StudioJobOutput): string {
  const lines = (output.onImageLines ?? []).map((l) => l.trim()).filter(Boolean);
  if (lines.length) return lines.join(" / ").slice(0, 200);
  return (output.onImageText ?? "").trim().slice(0, 200);
}

function wordSet(value: string): Set<string> {
  return new Set(tokens(value));
}

/** Share of the shorter text's words found in the other: short lines need words, not phrases. */
function overlap(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const w of left) if (right.has(w)) common++;
  return common / Math.min(left.size, right.size);
}

/**
 * Catch a joke, punchline or on-picture line the workspace already used, in
 * any format. Memes are short, so a few shared words already make a repeat.
 */
export function findRepeatedJoke(
  output: StudioJobOutput,
  recent: StudioContext["recent"],
): { title: string; joke: string } | null {
  const joke = outputJoke(output);
  if (tokens(joke).length < 2) return null;
  const punchline = (output.onImageLines ?? []).at(-1) ?? "";
  for (const item of recent) {
    const past = item.joke?.trim();
    if (!past || tokens(past).length < 2) continue;
    const same = joke.toLowerCase() === past.toLowerCase();
    const lastPast = past.split(" / ").at(-1) ?? "";
    const samePunchline = tokens(punchline).length >= 3 && overlap(punchline, lastPast) >= 0.8;
    if (same || samePunchline || overlap(joke, past) >= 0.7 || similarity(joke, past) >= 0.6)
      return { title: item.title, joke: past };
  }
  return null;
}

/**
 * The meme layouts the last posts used, newest first, so the next meme is
 * built on another one.
 */
export function recentMemeLayouts(recent: StudioContext["recent"], limit = 2): string[] {
  const out: string[] = [];
  for (const item of recent) {
    if (item.memeLayout && !out.includes(item.memeLayout)) out.push(item.memeLayout);
    if (out.length >= limit) break;
  }
  return out;
}
