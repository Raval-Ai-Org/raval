// wix-ricos.ts — a Studio article → the rich-content document Wix Blog stores.
//
// Wix Blog posts take "Ricos" JSON, not HTML: a tree of nodes (PARAGRAPH,
// HEADING, BULLETED_LIST, …) whose leaves are TEXT nodes with decorations
// (bold, italic, link). The article's markdown is parsed with the same
// remark/GFM parser as the HTML renderer, so both say the same thing:
// key takeaways, the body, then a visible FAQ (see render.ts).
//
// Only plain, safe structure is produced: no HTML embeds, scripts or widgets.
// Tables become one paragraph per row; images are left out (an image needs a
// Wix Media upload). Pure and browser-safe.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { PublishableArticle } from "./render";

type Decoration =
  | { type: "BOLD"; fontWeightValue: number }
  | { type: "ITALIC"; italicData: boolean }
  | { type: "LINK"; linkData: { link: { url: string; target: "BLANK" | "SELF" } } };

export type RicosNode = {
  type: string;
  id: string;
  nodes: RicosNode[];
  textData?: { text: string; decorations: Decoration[] };
  paragraphData?: Record<string, never>;
  headingData?: { level: number };
  bulletedListData?: { indentation: number };
  orderedListData?: { indentation: number };
  blockquoteData?: { indentation: number };
  codeBlockData?: Record<string, never>;
  dividerData?: Record<string, never>;
};

export type RicosDocument = { nodes: RicosNode[] };

type Md = {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  url?: string;
  children?: Md[];
};

/** Only web links are kept; anything else (javascript:, data:) becomes plain text. */
const safeUrl = (url: string | undefined) =>
  url && /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim()) ? url.trim() : null;

export function articleRicos(a: PublishableArticle): RicosDocument {
  let n = 0;
  const id = () => `m${(++n).toString(36)}`;

  const text = (value: string, decorations: Decoration[] = []): RicosNode => ({
    type: "TEXT",
    id: "",
    nodes: [],
    textData: { text: value, decorations },
  });

  function inline(nodes: Md[] | undefined, decorations: Decoration[] = []): RicosNode[] {
    const out: RicosNode[] = [];
    for (const node of nodes ?? []) {
      switch (node.type) {
        case "text":
          if (node.value) out.push(text(node.value, decorations));
          break;
        case "inlineCode":
          if (node.value) out.push(text(node.value, decorations));
          break;
        case "strong":
          out.push(
            ...inline(node.children, [...decorations, { type: "BOLD", fontWeightValue: 700 }]),
          );
          break;
        case "emphasis":
          out.push(
            ...inline(node.children, [...decorations, { type: "ITALIC", italicData: true }]),
          );
          break;
        case "delete":
          out.push(...inline(node.children, decorations));
          break;
        case "link": {
          const url = safeUrl(node.url);
          out.push(
            ...inline(
              node.children,
              url
                ? [
                    ...decorations,
                    {
                      type: "LINK",
                      linkData: {
                        link: { url, target: url.startsWith("http") ? "BLANK" : "SELF" },
                      },
                    },
                  ]
                : decorations,
            ),
          );
          break;
        }
        case "break":
          out.push(text("\n", decorations));
          break;
        default:
          // Images, footnote references, raw HTML: left out.
          if (node.children) out.push(...inline(node.children, decorations));
      }
    }
    return out;
  }

  const paragraph = (children: RicosNode[]): RicosNode => ({
    type: "PARAGRAPH",
    id: id(),
    nodes: children,
    paragraphData: {},
  });
  const heading = (level: number, children: RicosNode[]): RicosNode => ({
    type: "HEADING",
    id: id(),
    nodes: children,
    headingData: { level: Math.min(6, Math.max(2, level)) },
  });
  const list = (ordered: boolean, items: RicosNode[][]): RicosNode => ({
    type: ordered ? "ORDERED_LIST" : "BULLETED_LIST",
    id: id(),
    nodes: items.map((nodes) => ({ type: "LIST_ITEM", id: id(), nodes })),
    ...(ordered
      ? { orderedListData: { indentation: 0 } }
      : { bulletedListData: { indentation: 0 } }),
  });

  function block(node: Md): RicosNode[] {
    switch (node.type) {
      case "paragraph": {
        const kids = inline(node.children);
        return kids.length ? [paragraph(kids)] : [];
      }
      case "heading":
        // The post's own title is the page's H1; body headings start at H2.
        return [heading((node.depth ?? 2) <= 1 ? 2 : (node.depth ?? 2), inline(node.children))];
      case "list":
        return [
          list(
            !!node.ordered,
            (node.children ?? []).map((item) => {
              const inner = (item.children ?? []).flatMap(block);
              return inner.length ? inner : [paragraph([])];
            }),
          ),
        ];
      case "blockquote":
        return [
          {
            type: "BLOCKQUOTE",
            id: id(),
            nodes: (node.children ?? []).flatMap(block),
            blockquoteData: { indentation: 0 },
          },
        ];
      case "code":
        return node.value
          ? [{ type: "CODE_BLOCK", id: id(), nodes: [text(node.value)], codeBlockData: {} }]
          : [];
      case "thematicBreak":
        return [{ type: "DIVIDER", id: id(), nodes: [], dividerData: {} }];
      case "table":
        return (node.children ?? []).map((row) =>
          paragraph(
            (row.children ?? []).flatMap((cell, i) => [
              ...(i ? [text(" · ")] : []),
              ...inline(cell.children),
            ]),
          ),
        );
      default:
        return [];
    }
  }

  const nodes: RicosNode[] = [];
  if (a.takeaways.length) {
    nodes.push(heading(2, [text("Key takeaways")]));
    nodes.push(
      list(
        false,
        a.takeaways.map((t) => [paragraph([text(t)])]),
      ),
    );
  }
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(a.markdown.replace(/^#\s+.+\n+/, "")) as unknown as Md;
  nodes.push(...(tree.children ?? []).flatMap(block));
  if (a.faq.length) {
    nodes.push(heading(2, [text("Frequently asked questions")]));
    for (const f of a.faq) {
      nodes.push(heading(3, [text(f.question)]));
      nodes.push(paragraph([text(f.answer)]));
    }
  }
  return { nodes };
}

/** The plain text of a document (tests and length checks). */
export function ricosText(doc: RicosDocument): string {
  const walk = (ns: RicosNode[]): string =>
    ns.map((x) => (x.textData ? x.textData.text : walk(x.nodes))).join(" ");
  return walk(doc.nodes).replace(/\s+/g, " ").trim();
}
