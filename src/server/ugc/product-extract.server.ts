// Product understanding: fetch a product page through the SSRF guard, read
// its structured signals, then have Claude pull out facts, benefits, audience
// hints and use cases. Every fact must quote evidence that really appears on
// the page — facts whose evidence can't be found are dropped, so the concept
// engine only ever sees claims the business itself makes.
import "server-only";
import { claudeTextCompletion, CLAUDE_SONNET_MODEL } from "@/lib/anthropic-gateway.server";
import { normalizeUrl } from "@/lib/crawl/html";
import { evidenceOnPage, parseProductPage } from "@/lib/ugc/product-page";
import type { Product, ProductFact } from "@/lib/ugc/schemas";
import { BudgetExceededError } from "@/server/ai/budget";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";
import { HttpError } from "@/server/http-error";
import { log } from "@/server/observability/logger";
import { assertPublicUrl, ResponseTooLargeError, safeFetch } from "@/server/safe-fetch";

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

export type ExtractionResult = {
  product: Product;
  /** False when the AI step was unavailable and only page metadata was used. */
  analyzed: boolean;
};

const SYSTEM = `You extract product facts for advertising from a product web page.
${UNTRUSTED_DATA_RULE}
Rules:
- Only use information stated on the page. Never infer, embellish or add typical features of the category.
- Each fact is one short, specific, verifiable statement (a feature, ingredient, material, spec, included item, offer, or result the page itself claims).
- For every fact, "evidence" must be an exact short quote (3–15 words) copied from the page text.
- Benefits describe what the stated features do for the customer, based only on the facts.
- audienceHints and useCases come only from what the page says or clearly shows.
- If the page is not a product or service page, return empty lists.
- Write in the page's language.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "brand", "category", "description", "facts", "benefits", "audienceHints", "useCases"],
  properties: {
    name: { type: "string" },
    brand: { type: "string" },
    category: { type: "string" },
    description: { type: "string", description: "One or two plain sentences: what it is and who it's for." },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } },
      },
    },
    benefits: { type: "array", items: { type: "string" } },
    audienceHints: { type: "array", items: { type: "string" } },
    useCases: { type: "array", items: { type: "string" } },
  },
} as const;

type ModelOutput = {
  name: string;
  brand: string;
  category: string;
  description: string;
  facts: Array<{ text: string; evidence: string }>;
  benefits: string[];
  audienceHints: string[];
  useCases: string[];
};

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const list = (v: unknown, max: number, len: number) =>
  (Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean).slice(0, max);

export async function extractProduct(rawUrl: string): Promise<ExtractionResult> {
  const url = assertPublicUrl(normalizeUrl(rawUrl)).toString();
  let html: string;
  let finalUrl = url;
  try {
    const res = await safeFetch(url, {
      timeoutMs: 15_000,
      maxBytes: MAX_PAGE_BYTES,
      onOverflow: "truncate",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MelloxBot/1.0; +https://mellox.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      throw new HttpError(422, `We couldn't open that page (the site answered ${res.status}). Check the link or enter the product details manually.`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html|xml|text/i.test(type)) {
      throw new HttpError(422, "That link isn't a web page. Paste the product page URL.");
    }
    html = res.text();
    finalUrl = res.url;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ResponseTooLargeError) {
      throw new HttpError(422, "That page is too large to read. Enter the product details manually.");
    }
    // SsrfBlockedError propagates (the route kernel maps it to 400).
    if ((error as { name?: string })?.name === "SsrfBlockedError") throw error;
    throw new HttpError(422, "We couldn't reach that page. Check the link or enter the product details manually.");
  }

  const signals = parseProductPage(html, finalUrl);
  const pageText = [signals.description, signals.text].filter(Boolean).join("\n");
  const base: Product = {
    name: signals.name,
    brand: signals.brand,
    url: finalUrl,
    description: signals.description,
    price: signals.price,
    category: signals.category,
    images: signals.images,
    facts: signals.price ? [{ id: "price", text: `Price: ${signals.price}`, source: "page" }] : [],
    benefits: [],
    audienceHints: [],
    useCases: [],
  };

  if (pageText.trim().length < 80) {
    return { product: base, analyzed: false };
  }

  try {
    const result = await claudeTextCompletion({
      route: "ugc.product.extract",
      system: SYSTEM,
      user: `Product page: ${finalUrl}
Structured data found: ${JSON.stringify({
        name: signals.name,
        brand: signals.brand,
        price: signals.price,
        category: signals.category,
      })}

${wrapUntrusted("product page text", pageText, { maxChars: 12_000, route: "ugc.product.extract" })}`,
      model: CLAUDE_SONNET_MODEL,
      maxTokens: 3000,
      effort: "low",
      outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: 60_000,
      retries: 1,
    });
    const parsed = JSON.parse(result.text) as ModelOutput;
    const facts: ProductFact[] = [...base.facts];
    let dropped = 0;
    for (const f of Array.isArray(parsed.facts) ? parsed.facts : []) {
      const text = clip(f?.text, 300);
      if (!text) continue;
      if (!evidenceOnPage(clip(f?.evidence, 400), pageText)) {
        dropped++;
        continue;
      }
      if (facts.some((x) => x.text.toLowerCase() === text.toLowerCase())) continue;
      facts.push({ id: `f${facts.length + 1}`, text, source: "page" });
      if (facts.length >= 25) break;
    }
    if (dropped) log.info("ugc.product.facts_dropped", { dropped, kept: facts.length });
    return {
      analyzed: true,
      product: {
        ...base,
        name: clip(parsed.name, 160) || base.name,
        brand: clip(parsed.brand, 120) || base.brand,
        category: clip(parsed.category, 120) || base.category,
        description: clip(parsed.description, 2000) || base.description,
        facts,
        benefits: list(parsed.benefits, 8, 200),
        audienceHints: list(parsed.audienceHints, 6, 200),
        useCases: list(parsed.useCases, 6, 200),
      },
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    log.warn("ugc.product.analysis_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { product: base, analyzed: false };
  }
}
