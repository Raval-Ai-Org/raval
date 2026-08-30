import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId, assertPublicUrl } from "@/server/api-auth";

const BodySchema = z.object({ url: z.string().min(1).max(2000) });

const UA = "Mozilla/5.0 (compatible; RavalAI-Audit/1.0; +https://raval.ai/bot)";

type CheckStatus = "pass" | "warn" | "fail" | "info";
type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  weight?: number;
};
type Section = {
  id: string;
  title: string;
  blurb: string;
  checks: Check[];
};

function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function safeFetch(url: string, init?: RequestInit) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, accept: "*/*", ...(init?.headers ?? {}) },
      redirect: "follow",
      signal: ac.signal,
    });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}

function pick<T>(re: RegExp, s: string): T | null {
  const m = s.match(re);
  return m ? (m[1] as unknown as T) : null;
}

// ── AI crawler matrix ────────────────────────────────────────────────
const AI_BOTS = [
  { id: "GPTBot", who: "OpenAI training crawler (ChatGPT)" },
  { id: "ChatGPT-User", who: "ChatGPT browsing user-agent" },
  { id: "OAI-SearchBot", who: "ChatGPT search index" },
  { id: "ClaudeBot", who: "Anthropic Claude crawler" },
  { id: "Claude-Web", who: "Claude browsing user-agent" },
  { id: "PerplexityBot", who: "Perplexity index" },
  { id: "Google-Extended", who: "Gemini / Bard training" },
  { id: "Applebot-Extended", who: "Apple Intelligence" },
  { id: "CCBot", who: "Common Crawl (feeds most LLMs)" },
  { id: "Bytespider", who: "ByteDance / Doubao" },
] as const;

function parseRobotsAllow(robots: string, bot: string): "allow" | "block" | "unknown" {
  if (!robots) return "unknown";
  const lines = robots.split(/\r?\n/);
  // Walk groups
  let inGroup = false;
  let inWildcard = false;
  let blockBot = false;
  let blockWild = false;
  let agents: string[] = [];

  const apply = () => {
    if (agents.some((a) => a.toLowerCase() === bot.toLowerCase())) inGroup = true;
    if (agents.some((a) => a === "*")) inWildcard = true;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [kRaw, ...rest] = line.split(":");
    const k = kRaw.trim().toLowerCase();
    const v = rest.join(":").trim();
    if (k === "user-agent") {
      if (agents.length && (inGroup || inWildcard)) {
        // boundary already applied
      }
      // start of new group resets buffer if previous had rules
      agents = [v];
      // peek: keep collecting consecutive UAs
      continue;
    }
    if (k === "disallow") {
      apply();
      if (inGroup && v === "/") blockBot = true;
      if (inWildcard && v === "/") blockWild = true;
    }
  }
  if (blockBot) return "block";
  if (inGroup) return "allow"; // explicit group with no full disallow
  if (blockWild) return "block";
  return "allow";
}

// ── Audit ────────────────────────────────────────────────────────────
async function runAudit(rawUrl: string) {
  const base = assertPublicUrl(normalizeUrl(rawUrl));
  const origin = `${base.protocol}//${base.host}`;

  const [homeRes, robotsRes, sitemapRes, llmsRes, llmsFullRes] = await Promise.all([
    safeFetch(base.toString()),
    safeFetch(`${origin}/robots.txt`),
    safeFetch(`${origin}/sitemap.xml`),
    safeFetch(`${origin}/llms.txt`),
    safeFetch(`${origin}/llms-full.txt`),
  ]);

  const homeHtml = homeRes && homeRes.ok ? await homeRes.text() : "";
  const robots = robotsRes && robotsRes.ok ? await robotsRes.text() : "";
  const sitemap = sitemapRes && sitemapRes.ok ? await sitemapRes.text() : "";
  const llms = llmsRes && llmsRes.ok ? await llmsRes.text() : "";
  const llmsFull = llmsFullRes && llmsFullRes.ok ? await llmsFullRes.text() : "";

  const html = homeHtml;
  const lower = html.toLowerCase();

  // Meta extraction
  const title = pick<string>(/<title[^>]*>([^<]+)<\/title>/i, html) ?? "";
  const description =
    pick<string>(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i, html) ?? "";
  const canonical =
    pick<string>(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i, html) ?? "";
  const ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
  const ogDesc = /<meta[^>]+property=["']og:description["']/i.test(html);
  const ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
  const twitterCard = /<meta[^>]+name=["']twitter:card["']/i.test(html);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const langAttr = /<html[^>]+lang=["'][^"']+["']/i.test(html);
  const hreflang = /<link[^>]+rel=["']alternate["'][^>]+hreflang=/i.test(html);
  const charset = /<meta[^>]+charset=/i.test(html);
  const metaRobots =
    pick<string>(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i, html) ?? "";

  // Structured data
  const ldBlocks = Array.from(
    html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ).map((m) => m[1]);
  const ldTypes = new Set<string>();
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block.trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of arr) {
        const t = node?.["@type"];
        if (Array.isArray(t)) t.forEach((x: string) => ldTypes.add(String(x)));
        else if (t) ldTypes.add(String(t));
        if (node?.["@graph"]) {
          for (const g of node["@graph"]) {
            const gt = g?.["@type"];
            if (Array.isArray(gt)) gt.forEach((x: string) => ldTypes.add(String(x)));
            else if (gt) ldTypes.add(String(gt));
          }
        }
      }
    } catch {
      /* ignore malformed */
    }
  }

  // Headings
  const h1s = (html.match(/<h1\b[^>]*>/gi) ?? []).length;
  const h2s = (html.match(/<h2\b[^>]*>/gi) ?? []).length;
  const h3s = (html.match(/<h3\b[^>]*>/gi) ?? []).length;

  // Images & alt
  const imgs = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0]);
  const imgsWithAlt = imgs.filter((t) => /\salt\s*=/i.test(t)).length;
  const altCoverage = imgs.length ? Math.round((imgsWithAlt / imgs.length) * 100) : 100;

  // Links
  const links = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)).map((m) => m[1]);
  const internal = links.filter((h) => h.startsWith("/") || h.includes(base.host));
  const external = links.length - internal.length;

  // Semantic
  const semantic = {
    main: /<main\b/i.test(html),
    article: /<article\b/i.test(html),
    nav: /<nav\b/i.test(html),
    footer: /<footer\b/i.test(html),
    header: /<header\b/i.test(html),
    section: /<section\b/i.test(html),
  };
  const semanticCount = Object.values(semantic).filter(Boolean).length;

  // Content size
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = text ? text.split(" ").length : 0;
  const pageBytes = html.length;

  // FAQ markers
  const hasFaqSchema = ldTypes.has("FAQPage") || ldTypes.has("QAPage");
  const hasQuestionPattern =
    /(?:<h[1-4][^>]*>\s*(?:what|how|why|when|who|where|can|is|does)\b)/i.test(html);

  // E-E-A-T
  const hasOrgSchema = ldTypes.has("Organization") || ldTypes.has("LocalBusiness");
  const hasAuthor = ldTypes.has("Person") || /rel=["']author["']/i.test(html);
  const hasAboutLink = /href=["'][^"']*\/about[^"']*["']/i.test(html);
  const hasContact = /href=["'][^"']*\/contact[^"']*["']/i.test(html) || /mailto:/i.test(html);

  // Sitemap entries
  const sitemapEntries = sitemap ? (sitemap.match(/<loc>/gi) ?? []).length : 0;
  const isSitemapIndex = /<sitemapindex/i.test(sitemap);

  // robots.txt analysis
  const robotsHasSitemap = /sitemap:/i.test(robots);
  const botRows = AI_BOTS.map((b) => ({ ...b, state: parseRobotsAllow(robots, b.id) }));

  // HTTPS
  const https = base.protocol === "https:";

  // ── Build sections ───────────────────────────────────────────────
  const sections: Section[] = [];

  // 1. AI Engine Access
  const blockedBots = botRows.filter((b) => b.state === "block");
  sections.push({
    id: "ai-access",
    title: "AI Engine Access",
    blurb: "Are ChatGPT, Gemini, Claude and Perplexity allowed to read your site?",
    checks: [
      {
        id: "robots-present",
        label: "robots.txt published",
        status: robots ? "pass" : "warn",
        detail: robots
          ? `Found at ${origin}/robots.txt`
          : "No robots.txt detected — engines guess your rules.",
        weight: 4,
      },
      {
        id: "llms-txt",
        label: "llms.txt for AI crawlers",
        status: llms ? "pass" : "warn",
        detail: llms
          ? `Found at ${origin}/llms.txt${llmsFull ? " (+ llms-full.txt)" : ""}`
          : "Missing — add /llms.txt so LLMs know which pages to read.",
        weight: 5,
      },
      ...botRows.map<Check>((b) => ({
        id: `bot-${b.id}`,
        label: `${b.id}`,
        status: b.state === "block" ? "fail" : b.state === "allow" ? "pass" : "info",
        detail:
          b.state === "block"
            ? `Blocked in robots.txt — ${b.who} can't read your site.`
            : b.state === "allow"
              ? `${b.who} can crawl.`
              : `No rule for ${b.who}.`,
        weight: 2,
      })),
    ],
  });

  // 2. Structured Data
  const wantedTypes = [
    "Organization",
    "WebSite",
    "Article",
    "Product",
    "FAQPage",
    "BreadcrumbList",
    "Person",
  ];
  sections.push({
    id: "schema",
    title: "Structured Data (Schema.org)",
    blurb: "Schema is the #1 signal AI engines use to quote you with confidence.",
    checks: [
      {
        id: "ld-any",
        label: "JSON-LD present",
        status: ldBlocks.length ? "pass" : "fail",
        detail: ldBlocks.length
          ? `${ldBlocks.length} JSON-LD block(s) detected`
          : "No JSON-LD found — AI engines have nothing to ground answers on.",
        weight: 6,
      },
      ...wantedTypes.map<Check>((t) => ({
        id: `ld-${t}`,
        label: t,
        status: ldTypes.has(t) ? "pass" : t === "Organization" || t === "WebSite" ? "warn" : "info",
        detail: ldTypes.has(t) ? `${t} schema found.` : `Consider adding ${t} schema.`,
        weight: t === "Organization" ? 4 : 2,
      })),
      {
        id: "og",
        label: "Open Graph tags",
        status: ogTitle && ogDesc && ogImage ? "pass" : "warn",
        detail: `og:title ${ogTitle ? "✓" : "✗"} · og:description ${ogDesc ? "✓" : "✗"} · og:image ${ogImage ? "✓" : "✗"}`,
        weight: 2,
      },
      {
        id: "twitter",
        label: "Twitter Card",
        status: twitterCard ? "pass" : "warn",
        detail: twitterCard ? "twitter:card declared" : "Missing twitter:card meta.",
        weight: 1,
      },
    ],
  });

  // 3. Crawlability & Indexing
  sections.push({
    id: "crawl",
    title: "Crawlability & Indexing",
    blurb: "Without crawl, citations never happen.",
    checks: [
      {
        id: "https",
        label: "HTTPS",
        status: https ? "pass" : "fail",
        detail: https ? "Secure scheme." : "Not served over HTTPS — most engines deprioritize.",
        weight: 5,
      },
      {
        id: "sitemap",
        label: "sitemap.xml",
        status: sitemap ? "pass" : "warn",
        detail: sitemap
          ? `${sitemapEntries} URLs ${isSitemapIndex ? "(sitemap index)" : ""}`
          : "No sitemap detected at /sitemap.xml.",
        weight: 4,
      },
      {
        id: "robots-sitemap",
        label: "Sitemap declared in robots.txt",
        status: robotsHasSitemap ? "pass" : "warn",
        detail: robotsHasSitemap
          ? "robots.txt advertises a Sitemap."
          : "Add `Sitemap:` line to robots.txt.",
        weight: 2,
      },
      {
        id: "canonical",
        label: "Canonical URL",
        status: canonical ? "pass" : "warn",
        detail: canonical ? canonical : "No <link rel=canonical> on homepage.",
        weight: 3,
      },
      {
        id: "meta-robots",
        label: "Meta robots",
        status: /noindex/i.test(metaRobots) ? "fail" : "pass",
        detail: metaRobots || "default (index, follow)",
        weight: 4,
      },
      {
        id: "lang",
        label: "html lang attribute",
        status: langAttr ? "pass" : "warn",
        detail: langAttr ? "Declared." : "Missing <html lang=…>.",
        weight: 1,
      },
      {
        id: "hreflang",
        label: "hreflang",
        status: hreflang ? "pass" : "info",
        detail: hreflang ? "Internationalization declared." : "Add hreflang if multi-locale.",
        weight: 1,
      },
    ],
  });

  // 4. Content & Answer Signals
  sections.push({
    id: "content",
    title: "Answer-ready content",
    blurb: "LLMs quote clear, scannable, semantically structured pages.",
    checks: [
      {
        id: "title",
        label: "Title tag",
        status:
          title && title.length >= 20 && title.length <= 65 ? "pass" : title ? "warn" : "fail",
        detail: title ? `"${title}" · ${title.length} chars` : "Missing <title>.",
        weight: 4,
      },
      {
        id: "desc",
        label: "Meta description",
        status:
          description && description.length >= 70 && description.length <= 165
            ? "pass"
            : description
              ? "warn"
              : "fail",
        detail: description ? `${description.length} chars` : "Missing meta description.",
        weight: 3,
      },
      {
        id: "h1",
        label: "Single H1",
        status: h1s === 1 ? "pass" : h1s === 0 ? "fail" : "warn",
        detail: `${h1s} H1 · ${h2s} H2 · ${h3s} H3`,
        weight: 3,
      },
      {
        id: "wordcount",
        label: "Substantive copy",
        status: wordCount >= 400 ? "pass" : wordCount >= 150 ? "warn" : "fail",
        detail: `${wordCount.toLocaleString()} words of body text`,
        weight: 3,
      },
      {
        id: "semantic",
        label: "Semantic HTML",
        status: semanticCount >= 4 ? "pass" : semanticCount >= 2 ? "warn" : "fail",
        detail: `${semanticCount}/6 landmarks: ${
          Object.entries(semantic)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(", ") || "none"
        }`,
        weight: 3,
      },
      {
        id: "faq",
        label: "FAQ / Q&A signals",
        status: hasFaqSchema ? "pass" : hasQuestionPattern ? "warn" : "info",
        detail: hasFaqSchema
          ? "FAQ/QAPage schema present."
          : hasQuestionPattern
            ? "Question-style headings found but no FAQ schema."
            : "No Q&A patterns detected.",
        weight: 3,
      },
      {
        id: "alt",
        label: "Image alt coverage",
        status: altCoverage >= 90 ? "pass" : altCoverage >= 60 ? "warn" : "fail",
        detail: `${imgsWithAlt}/${imgs.length || 0} images have alt (${altCoverage}%)`,
        weight: 2,
      },
      {
        id: "links",
        label: "Internal linking",
        status: internal.length >= 5 ? "pass" : internal.length >= 1 ? "warn" : "fail",
        detail: `${internal.length} internal · ${external} external`,
        weight: 2,
      },
    ],
  });

  // 5. Trust & E-E-A-T
  sections.push({
    id: "trust",
    title: "Trust & E-E-A-T",
    blurb: "Entities, authorship and contact info make AI engines trust your name.",
    checks: [
      {
        id: "org-schema",
        label: "Organization entity",
        status: hasOrgSchema ? "pass" : "warn",
        detail: hasOrgSchema
          ? "Organization / LocalBusiness schema found."
          : "Add Organization JSON-LD with sameAs links.",
        weight: 4,
      },
      {
        id: "author",
        label: "Authorship",
        status: hasAuthor ? "pass" : "info",
        detail: hasAuthor
          ? "Author signals present."
          : "Add Person schema or rel=author for content pages.",
        weight: 2,
      },
      {
        id: "about",
        label: "About page linked",
        status: hasAboutLink ? "pass" : "warn",
        detail: hasAboutLink ? "Linked from homepage." : "Link an /about page from the homepage.",
        weight: 2,
      },
      {
        id: "contact",
        label: "Contact reachable",
        status: hasContact ? "pass" : "warn",
        detail: hasContact ? "Contact / email present." : "Add a contact route or email link.",
        weight: 2,
      },
    ],
  });

  // 6. Performance & shell
  sections.push({
    id: "performance",
    title: "Performance & rendering",
    blurb: "Heavy or JS-only pages get skipped by most LLM crawlers.",
    checks: [
      {
        id: "viewport",
        label: "Mobile viewport",
        status: viewport ? "pass" : "fail",
        detail: viewport ? "Responsive meta declared." : "Missing <meta name=viewport>.",
        weight: 3,
      },
      {
        id: "charset",
        label: "Charset declared",
        status: charset ? "pass" : "warn",
        detail: charset ? "OK" : "Add <meta charset=utf-8>.",
        weight: 1,
      },
      {
        id: "size",
        label: "HTML payload",
        status: pageBytes < 250_000 ? "pass" : pageBytes < 600_000 ? "warn" : "fail",
        detail: `${(pageBytes / 1024).toFixed(1)} KB of HTML`,
        weight: 2,
      },
      {
        id: "ssr",
        label: "Server-rendered content",
        status: wordCount >= 150 ? "pass" : "fail",
        detail:
          wordCount >= 150
            ? "Body text visible without JS."
            : "Almost no text in raw HTML — LLM crawlers may see an empty shell.",
        weight: 4,
      },
    ],
  });

  // ── Score ────────────────────────────────────────────────────────
  const subscores = sections.map((s) => {
    let earned = 0;
    let total = 0;
    for (const c of s.checks) {
      const w = c.weight ?? 1;
      if (c.status === "info") continue;
      total += w;
      if (c.status === "pass") earned += w;
      else if (c.status === "warn") earned += w * 0.5;
    }
    const pct = total ? Math.round((earned / total) * 100) : 100;
    return { id: s.id, title: s.title, score: pct };
  });
  const overall = Math.round(
    subscores.reduce((a, b) => a + b.score, 0) / Math.max(1, subscores.length),
  );

  // ── Action list ──────────────────────────────────────────────────
  const actions: { id: string; priority: "high" | "med" | "low"; title: string; detail: string }[] =
    [];
  if (!ldBlocks.length)
    actions.push({
      id: "ld",
      priority: "high",
      title: "Add JSON-LD schema",
      detail:
        "Start with Organization + WebSite on every page, then Article / FAQ / Product where relevant.",
    });
  if (!llms)
    actions.push({
      id: "llms",
      priority: "high",
      title: "Publish /llms.txt",
      detail:
        "Tell LLMs which canonical pages to use as sources, with a short pitch line at the top.",
    });
  if (blockedBots.length)
    actions.push({
      id: "bots",
      priority: "high",
      title: `Unblock ${blockedBots.length} AI crawler${blockedBots.length === 1 ? "" : "s"}`,
      detail: `Currently blocked: ${blockedBots.map((b) => b.id).join(", ")}.`,
    });
  if (!sitemap)
    actions.push({
      id: "sitemap",
      priority: "med",
      title: "Publish sitemap.xml",
      detail: "List every public URL and reference the sitemap in robots.txt.",
    });
  if (!hasFaqSchema)
    actions.push({
      id: "faq",
      priority: "med",
      title: "Add FAQ schema",
      detail: "FAQPage JSON-LD is the highest-ROI structured data for AI citations.",
    });
  if (wordCount < 150)
    actions.push({
      id: "ssr",
      priority: "high",
      title: "Server-render hero copy",
      detail: "Your homepage HTML has too little text — LLM crawlers see a blank page.",
    });
  if (!canonical)
    actions.push({
      id: "canonical",
      priority: "low",
      title: "Add canonical tags",
      detail: "Prevents duplicate-content dilution across engines.",
    });
  if (h1s !== 1)
    actions.push({
      id: "h1",
      priority: "low",
      title: "Use exactly one H1",
      detail: `Found ${h1s} H1 tags — engines pick the most prominent heading as the topic.`,
    });

  return {
    url: base.toString(),
    fetchedAt: Date.now(),
    overall,
    subscores,
    actions,
    sections,
    raw: {
      title,
      description,
      canonical,
      ldTypes: Array.from(ldTypes),
      wordCount,
      h1s,
      h2s,
      h3s,
      imgs: imgs.length,
      imgsWithAlt,
      sitemapEntries,
      robotsLength: robots.length,
      llmsLength: llms.length,
    },
  };
}

export const Route = createFileRoute("/api/geo-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "Invalid JSON");
        }

        const parsed = BodySchema.safeParse(body);
        if (!parsed.success) return jsonError(400, "Invalid body");

        try {
          const result = await runAudit(parsed.data.url);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Audit failed";
          return jsonError(400, msg);
        }
      },
    },
  },
});
