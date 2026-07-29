import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId, assertPublicUrl } from "@/server/api-auth";

const BodySchema = z.object({
  url: z.string().min(1).max(2000),
});

type Brand = {
  brandName: string;
  oneLiner: string;
  about: string;
  industry: string;
  businessModel: string;
  audience: string;
  voice: string;
  values: string;
  products: string;
  doRules: string;
  dontRules: string;
  audienceTags: string[];
  valueTags: string[];
  colors: { name: string; hex: string }[];
  fonts: string[];
  logoUrl: string | null;
  faviconUrl: string | null;
  socials: { platform: string; url: string }[];
  missing: string[];
  // Extended memory fields
  mission: string;
  vision: string;
  positioning: string;
  uniqueValueProp: string;
  keywords: string[];
  competitors: { name: string; url?: string; positioning?: string; strengths?: string; weaknesses?: string; notes?: string }[];
  customerSignals: {
    jobsToBeDone: string;
    painPoints: string;
    objections: string;
    buyingTriggers: string;
    decisionCriteria: string;
    channels: string;
    feedback: string;
  };
  insights: { title: string; body: string }[];
};


function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function absoluteUrl(href: string | null | undefined, base: URL): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function stripHtml(html: string, max = 8000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function pickAll(html: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(re)) if (m[1]) out.push(m[1].trim());
  return out;
}

function extractMeta(html: string) {
  const metas: Record<string, string> = {};
  const re = /<meta[^>]+(?:name|property|itemprop)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi;
  for (const m of html.matchAll(re)) metas[m[1].toLowerCase()] = m[2];
  const re2 = /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property|itemprop)=["']([^"']+)["']/gi;
  for (const m of html.matchAll(re2)) metas[m[2].toLowerCase()] = m[1];
  return metas;
}

function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {}
  }
  return out;
}

function extractColors(html: string): string[] {
  const hexes = new Set<string>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    // Skip pure white/black/greys
    if (/^#(fff(fff)?|000(000)?|[0-9a-f])\1{2,5}$/i.test(hex)) continue;
    hexes.add(hex);
  }
  // Frequency count
  const counts: Record<string, number> = {};
  const re = /#([0-9a-f]{6})\b/gi;
  for (const m of html.matchAll(re)) {
    const hex = `#${m[1].toLowerCase()}`;
    counts[hex] = (counts[hex] || 0) + 1;
  }
  return Array.from(hexes).sort((a, b) => (counts[b] || 0) - (counts[a] || 0)).slice(0, 12);
}

function extractFonts(html: string): string[] {
  const fonts = new Set<string>();
  // Google Fonts links
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^&"'>]+)/gi)) {
    const fam = decodeURIComponent(m[1]).split(/[:&]/)[0].replace(/\+/g, " ");
    if (fam) fonts.add(fam);
  }
  // font-family CSS declarations
  for (const m of html.matchAll(/font-family\s*:\s*([^;"}<]+)/gi)) {
    const first = m[1].split(",")[0].replace(/['"]/g, "").trim();
    if (first && !/^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first)) {
      fonts.add(first);
    }
  }
  return Array.from(fonts).slice(0, 6);
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 RavalBrandBot" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("text")) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function extractInternalLinks(html: string, base: URL): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)) {
    const abs = absoluteUrl(m[1], base);
    if (!abs) continue;
    try {
      const u = new URL(abs);
      if (u.hostname === base.hostname) links.add(u.toString().split("#")[0]);
    } catch {}
  }
  return Array.from(links);
}

const CANDIDATE_PATHS = [
  "/about", "/about-us", "/company", "/our-story", "/who-we-are", "/team", "/mission",
  "/products", "/product", "/services", "/solutions", "/features", "/platform", "/integrations",
  "/pricing", "/plans",
  "/contact", "/contact-us",
  "/blog", "/news", "/press",
  "/customers", "/case-studies", "/testimonials", "/reviews", "/stories",
  "/faq", "/help", "/support",
  "/careers", "/jobs",
  "/privacy", "/terms",
];

function pickSubPages(internal: string[], base: URL, limit = 8): string[] {
  const picked = new Set<string>();
  const baseHost = base.hostname;
  for (const link of internal) {
    try {
      const u = new URL(link);
      if (u.hostname !== baseHost) continue;
      const path = u.pathname.toLowerCase().replace(/\/$/, "");
      if (CANDIDATE_PATHS.some((p) => path === p || path.endsWith(p))) {
        picked.add(u.toString());
      }
    } catch {}
    if (picked.size >= limit) break;
  }
  return Array.from(picked).slice(0, limit);
}

function parseSitemapUrls(xml: string, base: URL, limit = 30): string[] {
  if (!xml) return [];
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    try {
      const u = new URL(m[1].trim());
      if (u.hostname === base.hostname) urls.push(u.toString());
    } catch {}
    if (urls.length >= limit) break;
  }
  return urls;
}

async function ddgSearch(query: string, timeoutMs = 6000): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 RavalBrandBot" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: { title: string; url: string; snippet: string }[] = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(re)) {
      let url = m[1];
      // DDG wraps with /l/?uddg=...
      const udMatch = url.match(/[?&]uddg=([^&]+)/);
      if (udMatch) { try { url = decodeURIComponent(udMatch[1]); } catch {} }
      const title = stripHtml(m[2], 200);
      const snippet = stripHtml(m[3], 320);
      if (title && url.startsWith("http")) out.push({ title, url, snippet });
      if (out.length >= 8) break;
    }
    return out;
  } catch {
    return [];
  }
}


export const Route = createFileRoute("/api/brand-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return jsonError(400, "Invalid request");
        }

        const { extractionCompletion, AiGatewayError } = await import("@/lib/ai-gateway.server");

        let safeUrl: URL;
        try {
          safeUrl = assertPublicUrl(normalizeUrl(body.url));
        } catch {
          return jsonError(400, "URL is not allowed");
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) => {
              try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch {}
            };
            const progress = (stage: string, message: string, pct: number) =>
              send({ type: "progress", stage, message, pct });

            try {
              progress("fetch_home", `Fetching ${safeUrl.hostname}`, 5);

              // 1. Fetch homepage
              const homeHtml = await fetchHtml(safeUrl.toString(), 10000);
              if (!homeHtml) progress("fetch_home", "Homepage returned no content — continuing anyway", 10);
              else progress("fetch_home", `Loaded homepage (${Math.round(homeHtml.length / 1024)} KB)`, 12);

              // 2. Discover and fetch sub-pages in parallel
              progress("discover", "Discovering internal pages", 18);
              const internalLinks = homeHtml ? extractInternalLinks(homeHtml, safeUrl) : [];
              let subUrls = pickSubPages(internalLinks, safeUrl, 8);

              progress("sitemap", "Reading sitemap.xml", 24);
              const sitemapXml = await fetchHtml(new URL("/sitemap.xml", safeUrl).toString(), 4000).catch(() => "");
              const sitemapUrls = parseSitemapUrls(sitemapXml, safeUrl, 60);
              if (subUrls.length < 8 && sitemapUrls.length) {
                const have = new Set(subUrls);
                const extra = pickSubPages(sitemapUrls, safeUrl, 8 - subUrls.length);
                for (const u of extra) if (!have.has(u)) subUrls.push(u);
              }
              subUrls = subUrls.slice(0, 8);

              progress("crawl", subUrls.length ? `Crawling ${subUrls.length} sub-page${subUrls.length === 1 ? "" : "s"}` : "No sub-pages found", 32);
              const subHtmls = await Promise.all(subUrls.map((u) => fetchHtml(u, 7000)));
              const crawledCount = subHtmls.filter(Boolean).length;
              progress("crawl", `Crawled ${crawledCount + (homeHtml ? 1 : 0)} page${crawledCount === 0 ? "" : "s"} total`, 48);

              // 4. Aggregate signals from all pages
              const allHtml = [homeHtml, ...subHtmls].filter(Boolean);
              const meta = extractMeta(homeHtml);
              const jsonLd = allHtml.flatMap(extractJsonLd);
              const colors = extractColors(allHtml.join("\n"));
              const fonts = extractFonts(allHtml.join("\n"));
              progress("signals", `Found ${colors.length} colors · ${fonts.length} fonts · ${jsonLd.length} structured data block${jsonLd.length === 1 ? "" : "s"}`, 56);

              // Logo / favicon
              const iconHref =
                pickAll(homeHtml, /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon|mask-icon)["'][^>]+href=["']([^"']+)["']/gi)[0] ||
                pickAll(homeHtml, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/gi)[0];
              const favicon = absoluteUrl(iconHref || "/favicon.ico", safeUrl);
              const ogImage = absoluteUrl(meta["og:image"] || meta["twitter:image"], safeUrl);

              let logoFromImg: string | null = null;
              const logoMatch = homeHtml.match(/<img[^>]+(?:alt|src|class)=["'][^"']*logo[^"']*["'][^>]*>/i);
              if (logoMatch) {
                const src = logoMatch[0].match(/src=["']([^"']+)["']/i)?.[1];
                if (src) logoFromImg = absoluteUrl(src, safeUrl);
              }

              const socials = new Set<string>();
              const socialRe = /https?:\/\/(?:www\.)?(?:linkedin\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|youtube\.com|tiktok\.com|github\.com|pinterest\.com|medium\.com|discord\.(?:gg|com)|t\.me|reddit\.com)\/[A-Za-z0-9_\-./?=]+/gi;
              for (const html of allHtml) {
                for (const m of html.matchAll(socialRe)) {
                  socials.add(m[0].replace(/["'<>].*$/, "").replace(/[),.;]$/, ""));
                }
              }

              const emails = new Set<string>();
              const phones = new Set<string>();
              for (const html of allHtml) {
                for (const m of html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
                  const e = m[0].toLowerCase();
                  if (!/\.(png|jpg|jpeg|webp|svg|gif)$/.test(e)) emails.add(e);
                }
                for (const m of html.matchAll(/(?:tel:|phone:?\s*)([+\d][\d\s().-]{7,}\d)/gi)) {
                  phones.add(m[1].trim());
                }
              }

              const headings: string[] = [];
              for (const html of allHtml) {
                for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
                  const t = stripHtml(m[1], 200);
                  if (t && t.length > 3 && t.length < 200) headings.push(t);
                }
              }

              const labeledText = [
                `[HOMEPAGE ${safeUrl.toString()}]\n${stripHtml(homeHtml, 5000)}`,
                ...subUrls.map((u, i) => `[PAGE ${u}]\n${stripHtml(subHtmls[i] || "", 3500)}`),
              ].filter((s) => !s.endsWith("\n")).join("\n\n---\n\n").slice(0, 22000);

              // 4b. External research
              const seedName =
                meta["og:site_name"] ||
                (meta["og:title"]?.split(/[|·\-—]/)[0]?.trim()) ||
                safeUrl.hostname.replace(/^www\./, "").split(".")[0];

              progress("search", `Searching the web for "${seedName}" mentions`, 62);
              const [extResAbout, extResCompetitors, extResReviews] = await Promise.all([
                ddgSearch(`"${seedName}" what they do site:${safeUrl.hostname} OR about`, 5000),
                ddgSearch(`${seedName} competitors alternatives`, 5000),
                ddgSearch(`${seedName} review OR testimonial OR feedback`, 5000),
              ]);
              const externalSnippets = [
                ...extResAbout.map((r) => ({ ...r, bucket: "About/Mentions" as const })),
                ...extResCompetitors.map((r) => ({ ...r, bucket: "Competitors" as const })),
                ...extResReviews.map((r) => ({ ...r, bucket: "Reviews/Feedback" as const })),
              ].slice(0, 18);
              progress("search", `Collected ${externalSnippets.length} external snippet${externalSnippets.length === 1 ? "" : "s"}`, 72);

              const sys = `You are a senior brand strategist + market researcher. From the multi-page website crawl AND external web mentions, extract a deep, accurate brand profile, competitors, customer signals, and durable insights.
Return STRICT JSON only matching the schema. Do NOT invent facts not supported by the provided text.
If a field is unknown after careful reading, set to "" (or []) and add the field name to "missing".
Be specific and concrete — use brand's own language where possible.
- oneLiner ≤ 100 chars (sharp positioning, not a tagline)
- about ≤ 320 chars (what they do, for whom, why it matters)
- mission / vision / positioning / uniqueValueProp: ≤ 200 chars each; only if clearly stated or strongly implied
- voice ≤ 160 chars (tone descriptors: e.g. "Confident, technical, dry humor")
- products: comma-separated list of actual product/service names found
- values: 3-5 core values inferred from copy
- audience: who they serve (segments, roles, industries)
- doRules / dontRules: 2-3 short brand guidelines each
- audienceTags / valueTags / keywords: 3-8 short tags each (keywords = SEO/topic terms relevant to the brand)
- colors: 3-6 palette colors from the detected hex list, pick the most brand-representative; name them ("Primary", "Accent", "Ink", "Surface", etc.)
- fonts: 1-3 typography family names from detected list
- competitors: up to 5 named competitors — ONLY from external snippets or explicit on-site mentions, with positioning/strengths/weaknesses where evident
- customerSignals: derived from testimonials/reviews/FAQ/objection handling on site + external review snippets. Use empty string if no evidence
- insights: 3-8 durable, non-obvious facts/decisions worth remembering (title ≤ 60 chars, body ≤ 200 chars). Examples: "Targets solo founders, not enterprise", "Pricing is usage-based, no free tier", "Tone leans technical, avoids hype"`;

              const schemaHint = `{
 "brandName": string, "oneLiner": string, "about": string,
 "industry": string, "businessModel": string, "audience": string,
 "voice": string, "values": string, "products": string,
 "doRules": string, "dontRules": string,
 "mission": string, "vision": string, "positioning": string, "uniqueValueProp": string,
 "audienceTags": string[], "valueTags": string[], "keywords": string[],
 "colors": [{"name": string, "hex": string}],
 "fonts": string[],
 "competitors": [{"name": string, "url"?: string, "positioning"?: string, "strengths"?: string, "weaknesses"?: string, "notes"?: string}],
 "customerSignals": {"jobsToBeDone": string, "painPoints": string, "objections": string, "buyingTriggers": string, "decisionCriteria": string, "channels": string, "feedback": string},
 "insights": [{"title": string, "body": string}],
 "missing": string[]
}`;

              const jsonLdSummary = jsonLd.length ? JSON.stringify(jsonLd.slice(0, 5)).slice(0, 3000) : "";
              const externalBlock = externalSnippets.length
                ? externalSnippets.map((r) => `[${r.bucket}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n")
                : "(no external results)";

              const userMsg = `URL: ${safeUrl.toString()}

META:
title: ${meta["og:title"] || ""}
description: ${meta["description"] || meta["og:description"] || ""}
og:site_name: ${meta["og:site_name"] || ""}
og:type: ${meta["og:type"] || ""}
theme-color: ${meta["theme-color"] || ""}
keywords: ${meta["keywords"] || ""}
author: ${meta["author"] || ""}
twitter:site: ${meta["twitter:site"] || ""}

JSON-LD (structured data):
${jsonLdSummary}

DETECTED COLORS (hex, by frequency): ${colors.join(", ")}
DETECTED FONTS: ${fonts.join(", ")}
SOCIALS: ${Array.from(socials).slice(0, 10).join(", ")}
EMAILS: ${Array.from(emails).slice(0, 5).join(", ")}
PHONES: ${Array.from(phones).slice(0, 3).join(", ")}

KEY HEADINGS (across pages):
${headings.slice(0, 30).map((h) => `• ${h}`).join("\n")}

CRAWLED PAGES (${1 + subUrls.length} total):
${labeledText}

EXTERNAL WEB MENTIONS (search snippets — useful for competitors, reviews, third-party context):
${externalBlock}

Return JSON only, matching:
${schemaHint}`;

              progress("analyze", "Analyzing with AI — synthesizing brand profile", 80);

              // Heartbeat while AI is working so the bar keeps creeping
              let pct = 80;
              const heartbeat = setInterval(() => {
                if (pct < 92) {
                  pct += 1;
                  progress("analyze", "Analyzing with AI — synthesizing brand profile", pct);
                }
              }, 800);

              let extracted: Partial<Brand> = {};
              try {
                const json: any = await extractionCompletion({
                  messages: [
                    { role: "system", content: sys },
                    { role: "user", content: userMsg },
                  ],
                  response_format: { type: "json_object" },
                });
                clearInterval(heartbeat);
                const text = json?.choices?.[0]?.message?.content ?? "{}";
                try { extracted = JSON.parse(text); } catch {
                  const m = text.match(/\{[\s\S]*\}/);
                  if (m) extracted = JSON.parse(m[0]);
                }
              } catch (e) {
                clearInterval(heartbeat);
                console.error("brand-extract ai error", e);
                const msg = e instanceof AiGatewayError ? e.message : "Extraction failed";
                send({ type: "error", error: msg });
                controller.close();
                return;
              }

              progress("finalize", "Merging signals & writing memory", 95);

              const org = jsonLd.find((j) => {
                const t = j?.["@type"];
                return t === "Organization" || (Array.isArray(t) && t.includes("Organization")) || t === "Corporation" || t === "LocalBusiness";
              });

              const titleGuess = meta["og:title"]?.split(/[|·\-—]/)[0]?.trim() || "";

              const result: Brand & { sources: Record<string, { label: string; snippet?: string; url?: string }>; extras: { emails: string[]; phones: string[]; headings: string[]; pagesCrawled: string[]; externalMentions: { bucket: string; title: string; url: string; snippet: string }[] } } = {
                brandName: extracted.brandName || org?.name || meta["og:site_name"] || titleGuess || "",
                oneLiner: extracted.oneLiner || meta["description"] || meta["og:description"] || org?.slogan || "",
                about: extracted.about || org?.description || "",
                industry: extracted.industry || "",
                businessModel: extracted.businessModel || "",
                audience: extracted.audience || "",
                voice: extracted.voice || "",
                values: extracted.values || "",
                products: extracted.products || "",
                doRules: extracted.doRules || "",
                dontRules: extracted.dontRules || "",
                audienceTags: Array.isArray(extracted.audienceTags) ? extracted.audienceTags.slice(0, 6) : [],
                valueTags: Array.isArray(extracted.valueTags) ? extracted.valueTags.slice(0, 6) : [],
                colors: Array.isArray(extracted.colors)
                  ? extracted.colors
                      .filter((c) => c && typeof c.hex === "string" && /^#?[0-9a-f]{6}$/i.test(c.hex))
                      .map((c) => ({ name: c.name || "Color", hex: c.hex.startsWith("#") ? c.hex : `#${c.hex}` }))
                      .slice(0, 6)
                  : [],
                fonts: Array.isArray(extracted.fonts) ? extracted.fonts.filter(Boolean).slice(0, 3) : [],
                logoUrl: logoFromImg || ogImage || (org?.logo && typeof org.logo === "string" ? org.logo : null) || favicon,
                faviconUrl: favicon,
                socials: Array.from(socials).slice(0, 12).map((url) => {
                  const platform = url.match(/(linkedin|twitter|x\.com|instagram|facebook|youtube|tiktok|github|pinterest|medium|discord|t\.me|reddit)/i)?.[1]?.toLowerCase().replace("x.com", "x").replace("t.me", "telegram") || "web";
                  return { platform, url };
                }),
                missing: Array.isArray(extracted.missing) ? extracted.missing : [],
                mission: extracted.mission || "",
                vision: extracted.vision || "",
                positioning: extracted.positioning || "",
                uniqueValueProp: extracted.uniqueValueProp || "",
                keywords: Array.isArray(extracted.keywords)
                  ? extracted.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 12)
                  : (meta["keywords"] || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
                competitors: Array.isArray(extracted.competitors)
                  ? extracted.competitors
                      .filter((c) => c && typeof c.name === "string" && c.name.trim())
                      .map((c) => ({
                        name: c.name.trim(),
                        url: typeof c.url === "string" ? c.url : undefined,
                        positioning: typeof c.positioning === "string" ? c.positioning : undefined,
                        strengths: typeof c.strengths === "string" ? c.strengths : undefined,
                        weaknesses: typeof c.weaknesses === "string" ? c.weaknesses : undefined,
                        notes: typeof c.notes === "string" ? c.notes : undefined,
                      }))
                      .slice(0, 5)
                  : [],
                customerSignals: {
                  jobsToBeDone: extracted.customerSignals?.jobsToBeDone || "",
                  painPoints: extracted.customerSignals?.painPoints || "",
                  objections: extracted.customerSignals?.objections || "",
                  buyingTriggers: extracted.customerSignals?.buyingTriggers || "",
                  decisionCriteria: extracted.customerSignals?.decisionCriteria || "",
                  channels: extracted.customerSignals?.channels || "",
                  feedback: extracted.customerSignals?.feedback || "",
                },
                insights: Array.isArray(extracted.insights)
                  ? extracted.insights
                      .filter((i) => i && typeof i.title === "string" && i.title.trim())
                      .map((i) => ({ title: i.title.trim().slice(0, 80), body: (typeof i.body === "string" ? i.body : "").trim().slice(0, 240) }))
                      .slice(0, 8)
                  : [],
                sources: {},
                extras: {
                  emails: Array.from(emails).slice(0, 5),
                  phones: Array.from(phones).slice(0, 3),
                  headings: headings.slice(0, 20),
                  pagesCrawled: [safeUrl.toString(), ...subUrls],
                  externalMentions: externalSnippets.map((r) => ({ bucket: r.bucket, title: r.title, url: r.url, snippet: r.snippet })),
                },
              };

              if (result.colors.length === 0 && meta["theme-color"] && /^#?[0-9a-f]{6}$/i.test(meta["theme-color"])) {
                const hex = meta["theme-color"].startsWith("#") ? meta["theme-color"] : `#${meta["theme-color"]}`;
                result.colors = [{ name: "Primary", hex }];
              }
              if (result.colors.length === 0 && colors.length > 0) {
                const names = ["Primary", "Accent", "Ink", "Surface", "Muted"];
                result.colors = colors.slice(0, 4).map((hex, i) => ({ name: names[i] || "Color", hex }));
              }
              if (result.fonts.length === 0 && fonts.length > 0) {
                result.fonts = fonts.slice(0, 3);
              }

              const homepage = safeUrl.toString();
              const s = result.sources;
              if (result.brandName) s.brandName = { label: org?.name ? "JSON-LD Organization" : meta["og:site_name"] ? "og:site_name" : "<title>", snippet: result.brandName, url: homepage };
              if (result.oneLiner) s.oneLiner = { label: extracted.oneLiner ? "AI synthesis" : "meta description", snippet: result.oneLiner.slice(0, 140), url: homepage };
              if (result.about) s.about = { label: org?.description ? "JSON-LD" : `AI synthesis across ${1 + subUrls.length} pages`, url: homepage };
              if (result.logoUrl) s.logo = { label: logoFromImg ? "logo <img>" : ogImage ? "og:image" : org?.logo ? "JSON-LD logo" : "favicon", url: result.logoUrl };
              if (result.colors.length) s.colors = { label: `${colors.length} hex colors detected in CSS`, snippet: colors.slice(0, 6).join(" "), url: homepage };
              if (result.fonts.length) s.fonts = { label: fonts.length ? `Detected ${fonts.length} font families` : "AI inference", url: homepage };
              if (result.industry) s.industry = { label: "AI inference from crawl", url: homepage };
              if (result.businessModel) s.businessModel = { label: "AI inference from crawl", url: homepage };
              if (result.audience) s.audience = { label: "AI inference from crawl", url: homepage };
              if (result.voice) s.voice = { label: "AI tone analysis", url: homepage };
              if (result.products) s.products = { label: "Headings & pages", url: homepage };
              if (result.values) s.values = { label: "AI inference from crawl", url: homepage };
              if (result.socials.length) s.socials = { label: `${result.socials.length} link${result.socials.length === 1 ? "" : "s"} across crawl`, url: homepage };
              if (result.extras.emails.length) s.emails = { label: `${result.extras.emails.length} email${result.extras.emails.length === 1 ? "" : "s"} found`, url: homepage };

              const miss: string[] = [];
              if (!result.brandName) miss.push("brandName");
              if (!result.oneLiner) miss.push("oneLiner");
              if (!result.industry) miss.push("industry");
              if (!result.businessModel) miss.push("businessModel");
              if (!result.audience) miss.push("audience");
              if (!result.products) miss.push("products");
              if (!result.values) miss.push("values");
              if (result.colors.length === 0) miss.push("colors");
              if (!result.logoUrl) miss.push("logo");
              result.missing = Array.from(new Set([...result.missing, ...miss]));

              void sitemapXml;

              progress("done", `Done — ${1 + subUrls.length} pages, ${result.competitors.length} competitor${result.competitors.length === 1 ? "" : "s"}, ${result.insights.length} insight${result.insights.length === 1 ? "" : "s"}`, 100);
              send({ type: "result", data: result });
              controller.close();
            } catch (err) {
              console.error("brand-extract stream error", err);
              try { send({ type: "error", error: "Extraction failed" }); } catch {}
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });

      },
    },
  },
});
