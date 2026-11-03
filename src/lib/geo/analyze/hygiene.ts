// hygiene.ts — markup checks that need their own pass over the HTML: text
// hidden from people but addressed to AI systems, insecure subresources,
// images without dimensions, controls without names, and DOM size.
//
// Adapted from GEO Optimizer's prompt-injection detector (MIT, (c) Juan Camilo
// Auriti — hidden CSS text, instructions in comments, invisible characters,
// data-attribute prompts) and SiteOne Crawler's accessibility and best-practice
// analyzers (MIT, (c) Ján Regeš). Pure: HTML in, plain data out.

import { tokenizeHtml, VOID_ELEMENTS } from "../html-tokenizer";
import { clip, collapse } from "./text";
import type { PageHygiene } from "../types";

/** Phrases that only make sense as instructions to a language model. */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget)\b[^.]{0,30}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instructions?|prompts?|rules|directions)\b/i,
  /\b(you are|act as|pretend to be)\s+(an?\s+)?(ai|assistant|chatbot|language model|llm|gpt)\b/i,
  /\b(ai|llm|language model|chatgpt|claude|gemini|perplexity|copilot|assistant|answer engine)s?\b[^.]{0,60}\b(must|should|always|never)\b[^.]{0,40}\b(recommend|say|state|tell|rank|cite|mention|describe|prefer)\b/i,
  /\bwhen (asked|summari[sz]ing|answering|responding)\b[^.]{0,80}\b(recommend|say|mention|rank|cite|describe)\b/i,
  /<\|?(im_start|im_end|system|endoftext|assistant)\|?>/i,
  /\[\/?(INST|SYS)\]/,
  /\b(system prompt|new instructions|override instructions)\b/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}

const HIDDEN_STYLE =
  /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*(0|0?\.\d+|1)(px|pt|em|rem)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(;|$)|color\s*:\s*transparent|(left|top|text-indent)\s*:\s*-\d{4,}px)/i;
// Zero-width space, word joiner, bidi embeddings/overrides/isolates. Joiners
// (U+200C/D) are left out: emoji and several scripts need them.
const INVISIBLE = /[\u200B\u2060\u202A-\u202E\u2066-\u2069]/g;
const PROMPT_ATTR = /^data-(ai|prompt|llm|gpt|chatgpt|claude)(-|$)/;
const GENERIC_ALT =
  /^(image|img|photo|picture|pic|graphic|logo|icon|banner|untitled|screenshot|placeholder|thumbnail|null|undefined)[\s_-]*\d*$/i;
const FILE_ALT =
  /(\.(jpe?g|png|gif|webp|svg|avif|bmp)$)|^(img|dsc|image|photo|screenshot)[_-]?\d+/i;
const IGNORE = new Set(["script", "style", "noscript", "template", "svg"]);
const LABELLABLE_INPUT = (type: string) =>
  !["hidden", "submit", "button", "reset", "image"].includes(type || "text");

const MAX_SAMPLES = 5;

export function analyzeHygiene(html: string, pageUrl: string): PageHygiene {
  const https = /^https:/i.test(pageUrl);
  const out: PageHygiene = {
    hiddenInstructions: [],
    commentInstructions: [],
    invisibleChars: 0,
    promptAttributes: 0,
    mixedContent: [],
    mixedContentCount: 0,
    images: { total: 0, withoutDimensions: 0, lazy: 0, genericAlt: 0 },
    blockingScripts: 0,
    stylesheets: 0,
    dom: { elements: 0, maxDepth: 0 },
    unlabeledControls: 0,
    unnamedControls: 0,
    iframesWithoutTitle: 0,
    duplicateIds: 0,
  };

  // Comments are dropped by the tokenizer, so they're read here. WordPress
  // block delimiters and IE conditionals are markup, not prose.
  for (const m of html.matchAll(/<!--([\s\S]{0,4000}?)-->/g)) {
    const body = m[1].trim();
    if (!body || /^(\/?wp:|\[if |<!\[endif)/i.test(body)) continue;
    if (looksLikeInstruction(body) && out.commentInstructions.length < MAX_SAMPLES) {
      out.commentInstructions.push(clip(collapse(body), 160));
    }
  }

  const stack: { name: string; hidden: boolean }[] = [];
  let hiddenDepth = 0;
  let hiddenText: string[] = [];
  let ignoreDepth = 0;
  let inHead = true;
  let labelDepth = 0;
  const ids = new Map<string, number>();
  const labelFor = new Set<string>();
  const controls: { id: string | null; named: boolean }[] = [];
  // Open <a>/<button> elements still collecting their accessible name.
  const naming: { name: string; named: boolean }[] = [];

  const flushHidden = () => {
    const text = collapse(hiddenText.join(" "));
    hiddenText = [];
    if (text && looksLikeInstruction(text) && out.hiddenInstructions.length < MAX_SAMPLES) {
      out.hiddenInstructions.push(clip(text, 160));
    }
  };
  const mixed = (value: string | undefined) => {
    if (!https || !value) return;
    for (const candidate of value.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (/^http:\/\//i.test(url)) {
        out.mixedContentCount++;
        if (out.mixedContent.length < MAX_SAMPLES) out.mixedContent.push(clip(url, 200));
      }
    }
  };

  for (const token of tokenizeHtml(html)) {
    if (token.type === "start") {
      const { name, attrs } = token;
      out.dom.elements++;
      if (name === "body") inHead = false;

      if (attrs.id) ids.set(attrs.id, (ids.get(attrs.id) ?? 0) + 1);
      for (const [key, value] of Object.entries(attrs)) {
        if (PROMPT_ATTR.test(key) && value.trim().length >= 20) out.promptAttributes++;
      }

      switch (name) {
        case "img": {
          out.images.total++;
          const style = attrs.style ?? "";
          const sized =
            (attrs.width && attrs.height) ||
            /aspect-ratio/i.test(style) ||
            (/(^|;)\s*width\s*:/i.test(style) && /(^|;)\s*height\s*:/i.test(style));
          if (!sized) out.images.withoutDimensions++;
          if ((attrs.loading ?? "").toLowerCase() === "lazy") out.images.lazy++;
          const alt = (attrs.alt ?? "").trim();
          if (alt && (GENERIC_ALT.test(alt) || FILE_ALT.test(alt))) out.images.genericAlt++;
          mixed(attrs.src);
          mixed(attrs.srcset);
          if (naming.length && alt) for (const n of naming) n.named = true;
          break;
        }
        case "script":
          mixed(attrs.src);
          if (
            inHead &&
            attrs.src &&
            !("async" in attrs) &&
            !("defer" in attrs) &&
            !/module|json/i.test(attrs.type ?? "")
          ) {
            out.blockingScripts++;
          }
          break;
        case "link": {
          const rel = (attrs.rel ?? "").toLowerCase();
          if (/\bstylesheet\b/.test(rel)) out.stylesheets++;
          if (/\b(stylesheet|preload|modulepreload|icon)\b/.test(rel)) mixed(attrs.href);
          break;
        }
        case "iframe":
          mixed(attrs.src);
          if (!(attrs.title ?? "").trim() && !(attrs["aria-label"] ?? "").trim()) {
            out.iframesWithoutTitle++;
          }
          break;
        case "source":
          mixed(attrs.src);
          mixed(attrs.srcset);
          break;
        case "video":
        case "audio":
        case "embed":
          mixed(attrs.src);
          break;
        case "object":
          mixed(attrs.data);
          break;
        case "label":
          if (attrs.for) labelFor.add(attrs.for);
          if (!token.selfClosing) labelDepth++;
          break;
        case "input":
        case "select":
        case "textarea":
          if (name !== "input" || LABELLABLE_INPUT((attrs.type ?? "").toLowerCase())) {
            controls.push({
              id: attrs.id ?? null,
              named:
                labelDepth > 0 ||
                Boolean(
                  (attrs["aria-label"] ?? "").trim() ||
                  (attrs["aria-labelledby"] ?? "").trim() ||
                  (attrs.title ?? "").trim(),
                ),
            });
          }
          break;
      }

      if ((name === "a" && attrs.href !== undefined) || name === "button") {
        naming.push({
          name,
          named: Boolean(
            (attrs["aria-label"] ?? "").trim() ||
            (attrs["aria-labelledby"] ?? "").trim() ||
            (attrs.title ?? "").trim(),
          ),
        });
      }

      if (VOID_ELEMENTS.has(name) || token.selfClosing) continue;

      const hidden =
        HIDDEN_STYLE.test(attrs.style ?? "") ||
        "hidden" in attrs ||
        (attrs["aria-hidden"] ?? "").toLowerCase() === "true";
      stack.push({ name, hidden });
      out.dom.maxDepth = Math.max(out.dom.maxDepth, stack.length);
      if (hidden) hiddenDepth++;
      if (IGNORE.has(name)) ignoreDepth++;
      continue;
    }

    if (token.type === "end") {
      const { name } = token;
      if (name === "label" && labelDepth > 0) labelDepth--;
      if (name === "a" || name === "button") {
        const idx = naming.map((n) => n.name).lastIndexOf(name);
        if (idx !== -1) {
          const [open] = naming.splice(idx, 1);
          if (!open.named) out.unnamedControls++;
        }
      }
      // Tolerant close: pop back to the matching open element, if there is one.
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) {
        const closed = stack.pop()!;
        if (IGNORE.has(closed.name) && ignoreDepth > 0) ignoreDepth--;
        if (closed.hidden) {
          hiddenDepth--;
          if (hiddenDepth === 0) flushHidden();
        }
      }
      continue;
    }

    if (ignoreDepth > 0) continue;
    const text = token.text;
    if (!text.trim()) continue;
    if (hiddenDepth > 0) {
      hiddenText.push(text);
      continue;
    }
    for (const n of naming) n.named = true;
    out.invisibleChars += text.match(INVISIBLE)?.length ?? 0;
  }
  if (hiddenDepth > 0) flushHidden();

  for (const [, count] of ids) if (count > 1) out.duplicateIds++;
  out.unlabeledControls = controls.filter((c) => !c.named && !(c.id && labelFor.has(c.id))).length;
  return out;
}
