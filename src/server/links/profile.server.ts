// What one brand needs from the placement catalog: the link text to use, and
// the words and categories that make a site relevant to it.
//
// Built from Brand DNA plus the target page itself, so nobody has to invent
// link text, and so two brands in different fields never get the same
// shortlist. One model call per brand and page, cached in memory.
import "server-only";

import { llmJson } from "@/lib/ai-gateway.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkBudget } from "@/server/ai/budget";
import { assertPublicUrl, safeFetch } from "@/server/safe-fetch";
import { readBrandDna } from "@/server/workspaces/brand-dna.server";
import { CATALOG_CATEGORIES, type RelevanceProfile } from "@/lib/links/rank";

const PAGE_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 512 * 1024;
const PROFILE_TTL_MS = 6 * 3600_000;

export type LinkProfile = RelevanceProfile & {
  /** Suggested link text, best first. Never empty. */
  keywords: string[];
  /** Language code the articles should be written in. */
  language: string;
};

export type BrandFacts = {
  name: string;
  industry: string;
  audience: string;
  about: string;
  products: string;
  keywords: string[];
  website: string;
};

/** A page, reduced to readable text. Never throws; null when too thin. */
export async function readPageText(url: string, maxChars = 4_000): Promise<string | null> {
  try {
    assertPublicUrl(url);
    const response = await safeFetch(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES,
      onOverflow: "truncate",
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;

    const html = response.text();
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();

    const combined = title ? `${title}. ${text}` : text;
    return combined.length < 200 ? null : combined.slice(0, maxChars);
  } catch {
    return null;
  }
}

function asText(value: unknown, max = 500): string {
  if (typeof value === "string") return value.slice(0, max);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? String(
                (item as Record<string, unknown>).name ??
                  (item as Record<string, unknown>).title ??
                  "",
              )
            : "",
      )
      .filter(Boolean)
      .join(", ")
      .slice(0, max);
  }
  return "";
}

export async function loadBrandFacts(workspaceId: string): Promise<BrandFacts> {
  const [workspace, dna] = await Promise.all([
    supabaseAdmin
      .from("workspaces")
      .select("name, industry, audience")
      .eq("id", workspaceId)
      .maybeSingle(),
    readBrandDna(supabaseAdmin, workspaceId).catch(() => null),
  ]);

  const stored = (dna?.dna ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(stored.keywords)
    ? stored.keywords.filter((k): k is string => typeof k === "string").slice(0, 20)
    : [];

  return {
    name: asText(stored.brandName, 120) || (workspace.data?.name ?? ""),
    industry: asText(stored.industry, 200) || (workspace.data?.industry ?? ""),
    audience: asText(stored.audience, 400) || (workspace.data?.audience ?? ""),
    about: asText(stored.oneLiner, 300) || asText(stored.about, 600),
    products: asText(stored.products, 500),
    keywords,
    website: asText(stored.websiteUrl, 200),
  };
}

const PROFILE_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["keywords", "topics", "categories", "language", "tlds"],
  additionalProperties: false,
  properties: {
    keywords: { type: "array", items: { type: "string", maxLength: 80 } },
    topics: { type: "array", items: { type: "string", maxLength: 40 } },
    categories: {
      type: "array",
      items: { type: "string", enum: [...CATALOG_CATEGORIES] },
    },
    language: { type: "string", maxLength: 5 },
    tlds: { type: "array", items: { type: "string", maxLength: 6 } },
  },
};

const PROFILE_SYSTEM = `You prepare a backlink order for one brand. Another website
will publish an article containing one link to the brand's page.

Return:
- "keywords": 6 to 8 candidate link texts for the link to that exact page, best
  first. Natural phrases a real person searches for, 2 to 5 words, lower case,
  in the page's language. Mix: the main search phrase the page should rank for,
  close variants, and one or two longer, specific ones. Never just the bare
  brand name, never "click here", never a URL.
- "topics": 12 to 24 single lower-case words (no spaces) that would appear in
  the domain name or article addresses of websites whose readers match this
  brand — the field, its sub-topics, and what those readers care about. For a
  dental clinic: dental, teeth, smile, health, dentist, oral, clinic, wellness.
  Only real words, 4+ letters.
- "categories": 1 to 5 of the allowed website categories that suit the brand's
  readers, best first.
- "language": the two-letter code of the language the page is written in.
- "tlds": country domain extensions (without the dot) whose websites write in
  that language, e.g. ["uk","ca","au","ie","nz"] for English.

Use only the facts and page text supplied. Do not invent products or claims.`;

type ProfileDraft = {
  keywords: string[];
  topics: string[];
  categories: string[];
  language: string;
  tlds: string[];
};

const cache = new Map<string, { at: number; profile: LinkProfile }>();

function cleanList(values: unknown, max: number, pattern?: RegExp): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (!cleaned || seen.has(cleaned) || (pattern && !pattern.test(cleaned))) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

/** Without a model: the Brand DNA keywords and the page's own words. */
function fallbackProfile(facts: BrandFacts, targetUrl: string): LinkProfile {
  const keywords = cleanList(facts.keywords, 8).filter((k) => k.split(" ").length <= 6);
  if (keywords.length === 0) {
    const industry = facts.industry.trim().toLowerCase();
    if (industry) keywords.push(industry.slice(0, 60));
    if (facts.name) keywords.push(facts.name.toLowerCase().slice(0, 60));
    if (keywords.length === 0) keywords.push(new URL(targetUrl).hostname.replace(/^www\./, ""));
  }
  const topics = cleanList(
    `${facts.industry} ${keywords.join(" ")}`.split(/[^a-zA-Z]+/),
    20,
    /^[a-z]{4,}$/,
  );
  return { keywords, topics, categories: [], language: "en", tlds: ["uk", "ca", "au"] };
}

export async function buildLinkProfile(
  workspaceId: string,
  targetUrl: string,
): Promise<LinkProfile> {
  const key = `${workspaceId}|${targetUrl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.profile;

  const [facts, pageText] = await Promise.all([
    loadBrandFacts(workspaceId),
    readPageText(targetUrl, 3_500),
  ]);
  const fallback = fallbackProfile(facts, targetUrl);

  const budget = await checkBudget("text", { workspaceId });
  if (budget.mode === "block") return fallback;

  const draft = await llmJson<ProfileDraft | null>({
    route: "links-profile",
    maxTokens: 900,
    timeoutMs: 40_000,
    outputSchema: PROFILE_SCHEMA,
    fallback: null,
    system: PROFILE_SYSTEM,
    user: [
      `Brand: ${facts.name || "(not set)"}`,
      facts.industry ? `Industry: ${facts.industry}` : null,
      facts.about ? `About: ${facts.about}` : null,
      facts.products ? `Products or services: ${facts.products}` : null,
      facts.audience ? `Audience: ${facts.audience}` : null,
      facts.keywords.length ? `Known keywords: ${facts.keywords.join(", ")}` : null,
      `Page that will receive the link: ${targetUrl}`,
      pageText
        ? `Text from that page:\n"""\n${pageText}\n"""`
        : "The page could not be read; use the brand facts.",
      `Allowed website categories: ${CATALOG_CATEGORIES.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }).catch((error) => {
    console.warn(
      "[links] brand profile call failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  if (!draft) return fallback;

  const allowed = new Set<string>(CATALOG_CATEGORIES.map((c) => c.toLowerCase()));
  const keywords = cleanList(draft.keywords, 8).filter(
    (k) => k.length >= 3 && !/^https?:|click here/.test(k),
  );
  const profile: LinkProfile = {
    keywords: keywords.length ? keywords : fallback.keywords,
    topics: cleanList(draft.topics, 24, /^[a-z0-9-]{4,}$/),
    categories: (Array.isArray(draft.categories) ? draft.categories : [])
      .filter((c): c is string => typeof c === "string" && allowed.has(c.toLowerCase()))
      .slice(0, 5),
    language: /^[a-z]{2}$/i.test(draft.language ?? "") ? draft.language.toLowerCase() : "en",
    tlds: cleanList(draft.tlds, 8, /^[a-z]{2,3}$/),
  };
  if (profile.topics.length === 0) profile.topics = fallback.topics;

  cache.set(key, { at: Date.now(), profile });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return profile;
}
