// html-tokenizer.ts — a small, tolerant, streaming HTML tokenizer for the GEO
// page extractor (a port of the stdlib HTMLParser the GEO module relied on).
// Crawled markup is untrusted and often malformed, so the tokenizer never
// throws: unterminated tags become text, unclosed comments run to the end,
// and <script>/<style> bodies are read raw up to their closing tag.
//
// Pure — no DOM, no I/O — so it runs identically in the scan worker and tests.

export type HtmlToken =
  | { type: "start"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "end"; name: string }
  | { type: "text"; text: string };

/** Elements whose content is raw text (never parsed as markup). */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
};

/** Decode character references. Unknown named entities are kept verbatim. */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : +body.slice(1);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue; // first occurrence wins, as in browsers
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

/** Find the `>` that closes a tag, skipping quoted attribute values. */
function tagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/**
 * Tokenize `html` into start/end/text tokens. Comments, doctypes and
 * processing instructions are dropped. Text is entity-decoded, except inside
 * <script>/<style> (whose raw content JSON-LD parsing needs intact).
 */
export function* tokenizeHtml(html: string): Generator<HtmlToken> {
  const len = html.length;
  let i = 0;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      yield { type: "text", text: decodeEntities(html.slice(i)) };
      return;
    }
    if (lt > i) yield { type: "text", text: decodeEntities(html.slice(i, lt)) };

    // Comment
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? len : close + 3;
      continue;
    }
    // Doctype / CDATA / processing instruction
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const close = html.indexOf(">", lt + 2);
      i = close === -1 ? len : close + 1;
      continue;
    }

    const isEnd = html[lt + 1] === "/";
    const nameStart = isEnd ? lt + 2 : lt + 1;
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      // A stray "<" — keep it as text.
      yield { type: "text", text: "<" };
      i = lt + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const end = tagEnd(html, nameStart + nameMatch[0].length);
    if (end === -1) {
      yield { type: "text", text: decodeEntities(html.slice(lt)) };
      return;
    }

    if (isEnd) {
      yield { type: "end", name };
      i = end + 1;
      continue;
    }

    const attrSource = html.slice(nameStart + nameMatch[0].length, end);
    const selfClosing = /\/\s*$/.test(attrSource);
    yield { type: "start", name, attrs: parseAttrs(attrSource.replace(/\/\s*$/, "")), selfClosing };
    i = end + 1;

    if (RAW_TEXT.has(name) && !selfClosing) {
      const closeRe = new RegExp(`</${name}\\s*>`, "ig");
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      const bodyEnd = close ? close.index : len;
      const body = html.slice(i, bodyEnd);
      if (body) {
        const decoded = name === "script" || name === "style" ? body : decodeEntities(body);
        yield { type: "text", text: decoded };
      }
      if (close) yield { type: "end", name };
      i = close ? close.index + close[0].length : len;
    }
  }
}

/** Elements that never have content. */
export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
