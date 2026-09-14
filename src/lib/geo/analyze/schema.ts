// schema.ts — JSON-LD parsing and summarisation (ports the GEO module's
// _traverse_json_ld, breadcrumb and FAQ extraction, and the schema parts of
// the trust / transparency / authority engines).

import type { SchemaAuthor, SchemaOrganization, SchemaSummary } from "../types";
import { collapse } from "./text";

type Node = Record<string, unknown>;

const ORG_TYPES = /organization$|^(corporation|localbusiness|ngo|store|restaurant)$/i;
const MAX_NODES = 400;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? collapse(v) : null;
}

function typesOf(node: Node): string[] {
  return asArray(node["@type"])
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
}

function urls(v: unknown): string[] {
  return asArray(v)
    .map((x) => (typeof x === "string" ? x.trim() : (str((x as Node)?.["@id"]) ?? "")))
    .filter((x) => /^https?:\/\//i.test(x));
}

/** Depth-first walk of every object inside a parsed JSON-LD payload. */
function walk(value: unknown, visit: (node: Node) => void, budget = { n: 0 }, depth = 0): void {
  if (depth > 12 || budget.n > MAX_NODES) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, budget, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  budget.n++;
  const node = value as Node;
  visit(node);
  for (const child of Object.values(node)) {
    if (child && typeof child === "object") walk(child, visit, budget, depth + 1);
  }
}

function answerText(q: Node): string {
  for (const key of ["acceptedAnswer", "suggestedAnswer"]) {
    for (const a of asArray(q[key])) {
      if (typeof a === "string") return collapse(a);
      const text = str((a as Node)?.text);
      if (text) return text;
    }
  }
  return "";
}

export function summarizeJsonLd(blocks: string[]): SchemaSummary {
  const summary: SchemaSummary = {
    blocks: blocks.length,
    parseErrors: 0,
    types: [],
    names: [],
    organizations: [],
    authors: [],
    publisherName: null,
    datePublished: null,
    dateModified: null,
    faq: [],
    hasBreadcrumbList: false,
    hasWebSite: false,
    hasAddress: false,
  };
  const types = new Set<string>();
  const names = new Set<string>();
  const orgs = new Map<string, SchemaOrganization>();
  const authors = new Map<string, SchemaAuthor>();

  for (const raw of blocks) {
    const text = raw.trim();
    if (!text) {
      summary.parseErrors++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Some CMSs wrap JSON-LD in HTML comments or CDATA; retry once without them.
      try {
        parsed = JSON.parse(
          text.replace(/^<!--|-->$|^\/\*<!\[CDATA\[\*\/|\/\*\]\]>\*\/$/g, "").trim(),
        );
      } catch {
        summary.parseErrors++;
        continue;
      }
    }

    walk(parsed, (node) => {
      const nodeTypes = typesOf(node);
      nodeTypes.forEach((t) => types.add(t));
      const name = str(node.name);
      if (name && nodeTypes.length) names.add(name);

      if (nodeTypes.some((t) => ORG_TYPES.test(t)) && name) {
        const existing = orgs.get(name.toLowerCase());
        const org: SchemaOrganization = existing ?? {
          name,
          types: [],
          sameAs: [],
          hasLogo: false,
          hasAddress: false,
          hasContactPoint: false,
        };
        for (const t of nodeTypes) if (!org.types.includes(t)) org.types.push(t);
        for (const u of urls(node.sameAs)) if (!org.sameAs.includes(u)) org.sameAs.push(u);
        org.hasLogo ||= node.logo !== undefined;
        org.hasAddress ||= node.address !== undefined;
        org.hasContactPoint ||= node.contactPoint !== undefined || node.telephone !== undefined;
        orgs.set(name.toLowerCase(), org);
      }

      if (node.address !== undefined) summary.hasAddress = true;
      if (nodeTypes.includes("BreadcrumbList")) summary.hasBreadcrumbList = true;
      if (nodeTypes.includes("WebSite")) summary.hasWebSite = true;

      for (const a of asArray(node.author)) {
        const authorName = typeof a === "string" ? collapse(a) : str((a as Node)?.name);
        if (!authorName || authors.has(authorName.toLowerCase())) continue;
        const an = (typeof a === "object" ? a : {}) as Node;
        authors.set(authorName.toLowerCase(), {
          name: authorName,
          jobTitle: str(an.jobTitle),
          url: str(an.url),
          sameAs: urls(an.sameAs),
        });
      }

      const publisher = asArray(node.publisher)[0] as Node | string | undefined;
      if (!summary.publisherName && publisher) {
        summary.publisherName =
          typeof publisher === "string" ? collapse(publisher) : str(publisher.name);
      }
      summary.datePublished ??= str(node.datePublished);
      summary.dateModified ??= str(node.dateModified);

      if (nodeTypes.some((t) => /^(faqpage|qapage)$/i.test(t))) {
        for (const q of asArray(node.mainEntity)) {
          const question = str((q as Node)?.name);
          if (question && summary.faq.length < 50) {
            summary.faq.push({ question, answer: answerText(q as Node).slice(0, 600) });
          }
        }
      }
    });
  }

  summary.types = [...types].sort();
  summary.names = [...names].slice(0, 50);
  summary.organizations = [...orgs.values()].slice(0, 10);
  summary.authors = [...authors.values()].slice(0, 10);
  return summary;
}
