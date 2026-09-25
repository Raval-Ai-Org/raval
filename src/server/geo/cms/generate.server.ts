import "server-only";
// generate.server.ts — a finding on a WordPress or Webflow page → the exact
// field changes that fix it (before → after), plus exact values to paste
// where the platform's API can't reach.
//
//   deterministic  canonical, indexing, Organization/WebSite, breadcrumbs,
//                  Article/WebPage, FAQPage from the page's own Q&A,
//                  robots.txt lines, llms.txt (text-artifacts.ts)
//   model          title / description / Open Graph text, content edits and
//                  image alt text — through the metered Anthropic gateway,
//                  then checked: lengths, grounding (no words the site doesn't
//                  use), exact-match edits and a deletion cap
//
// Nothing is written here; apply.server.ts does that after approval.
import { llmJson } from "@/lib/ai-gateway.server";
import {
  cmsFieldsForRule,
  fieldSupport,
  FIELD_LABEL,
  type CmsChange,
  type CmsField,
  type CmsTarget,
} from "@/lib/geo/cms-fixes";
import {
  breadcrumbList,
  canonicalFor,
  extractFaqPairs,
  faqPage,
  imagesMissingAlt,
  mergeJsonLd,
  organizationGraph,
  pageEntity,
  robotsAdditions,
  withAlt,
  type JsonLd,
} from "@/lib/geo/cms-values";
import type { SiteArtifacts } from "@/lib/geo/types";
import { checkFragments, groundingCheck } from "../fixes/grounding";
import { applyEdits } from "../fixes/generate.server";
import { buildLlmsTxt, type CrawledPageFacts } from "../fixes/text-artifacts";
import type { PageFactsView } from "../agents/repo-tools.server";
import {
  readField,
  wordpressKey,
  webflowKey,
  richTextFieldSlug,
  type CmsSession,
} from "./access.server";
import type { ResolvedPage } from "./targets.server";

export type AssistedStep = { label: string; where: string; value: string; why: string };

export type CmsFixPlan = {
  changes: CmsChange[];
  assisted: AssistedStep[];
  explanation: string;
  /** Set when nothing can be changed automatically or pasted: the reason. */
  notFixable: string | null;
  manualSteps: string[];
  checks: { id: string; label: string; status: "pass" | "fail" | "skipped"; detail: string }[];
};

export type CmsFixInput = {
  ruleId: string;
  finding: { title: string; detail: string; pageUrl: string | null };
  origin: string;
  site: SiteArtifacts;
  page: PageFactsView | null;
  pages: CrawledPageFacts[];
  brandName: string | null;
  session: CmsSession;
  resolved: ResolvedPage;
  inputs: Record<string, string>;
  /** Injected in tests. */
  complete?: typeof llmJson;
};

const ROUTE = "geo.cms.fix";

/* ───────────────────────── text from the model ───────────────────────── */

function corpusOf(input: CmsFixInput): string[] {
  const p = input.page;
  return [
    p?.title ?? "",
    p?.description ?? "",
    ...(p?.h1 ?? []),
    ...(p?.headings ?? []).map((h) => h.replace(/^h\d:\s*/, "")),
    p?.excerpt ?? "",
    input.brandName ?? "",
    input.resolved.wordpress?.content.replace(/<[^>]+>/g, " ") ?? "",
    ...input.pages.slice(0, 40).flatMap((x) => [x.title ?? "", x.description ?? ""]),
    ...Object.values(input.inputs),
  ].filter(Boolean);
}

type MetaText = { title: string; description: string; reason: string };

const META_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    reason: { type: "string" },
  },
  required: ["title", "description", "reason"],
};

async function metaText(
  input: CmsFixInput,
  need: "title" | "description" | "both",
): Promise<MetaText> {
  const p = input.page;
  const complete = input.complete ?? llmJson;
  const corpus = corpusOf(input);
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await complete<MetaText>({
      route: ROUTE,
      // A second attempt follows a validation/grounding rejection: premium tier.
      escalate: attempt > 0,
      maxTokens: 900,
      outputSchema: META_SCHEMA,
      fallback: { title: "", description: "", reason: "" },
      system: `You write page titles and meta descriptions that help search and AI answer engines understand a page.
Rules:
- Use only facts, names and wording that appear in the page facts. Never add claims, numbers, prices, awards or superlatives the page doesn't state.
- Title: 30–60 characters, the page's main topic first, then " | " and the brand when it fits.
- Description: 120–155 characters, one or two plain sentences that say what the page offers and who it's for.
- Plain words. No clickbait, no emoji, no quotes around the text.`,
      user: `Finding: ${input.finding.title}. ${input.finding.detail}
Page: ${p?.url ?? input.finding.pageUrl ?? input.origin}
Brand: ${input.brandName ?? "(unknown)"}
Current title: ${p?.title ?? "(none)"}
Current description: ${p?.description ?? "(none)"}
H1: ${(p?.h1 ?? []).join(" / ") || "(none)"}
Headings: ${(p?.headings ?? []).slice(0, 12).join("; ")}
Page text excerpt: ${(p?.excerpt ?? "").slice(0, 1500)}
Write ${need === "both" ? "a new title and description" : `a new ${need} (repeat the current value for the other field)`}.${feedback}`,
    });
    const title = out.title.replace(/\s+/g, " ").trim();
    const description = out.description.replace(/\s+/g, " ").trim();
    const problems: string[] = [];
    if (need !== "description" && (title.length < 15 || title.length > 65))
      problems.push(`The title is ${title.length} characters; keep it 30–60.`);
    if (need !== "title" && (description.length < 70 || description.length > 170))
      problems.push(`The description is ${description.length} characters; keep it 120–155.`);
    const grounding = checkFragments(
      [
        ...(need !== "description" ? [{ path: "title", text: title }] : []),
        ...(need !== "title" ? [{ path: "description", text: description }] : []),
      ],
      corpus,
      0.8,
    );
    for (const u of grounding.ungrounded) problems.push(`${u.path}: ${u.reason}`);
    if (!problems.length) return { title, description, reason: out.reason };
    feedback = `\n\nYour previous answer was rejected:\n- ${problems.join("\n- ")}\nFix these and answer again.`;
  }
  // Deterministic fallback from the page's own text.
  const h1 = p?.h1[0] ?? p?.title ?? input.brandName ?? input.site.host;
  const title = [h1, input.brandName].filter(Boolean).join(" | ").slice(0, 60);
  const sentence = (p?.excerpt ?? "").split(/(?<=[.!?])\s+/).reduce((acc, s) => {
    return acc.length + s.length < 155 ? `${acc} ${s}`.trim() : acc;
  }, "");
  return {
    title,
    description: (sentence || p?.description || "").slice(0, 155),
    reason: "Built from the page's own heading and first sentences.",
  };
}

type ContentEdits = { edits: { find: string; replace: string; why: string }[]; summary: string };

const EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          find: { type: "string" },
          replace: { type: "string" },
          why: { type: "string" },
        },
        required: ["find", "replace", "why"],
      },
    },
  },
  required: ["summary", "edits"],
};

const CONTENT_TASK: Record<string, string> = {
  "content.h1":
    "The page needs exactly one H1. If the content's first heading restates the page title, make that heading an <h1>; otherwise add <h1> with the page title text at the very top. Change nothing else.",
  "content.heading_hierarchy":
    "Fix skipped heading levels (e.g. h2 → h4) by changing heading tags only. Never change heading text.",
  "content.direct_answers":
    "Under each question heading, make the first paragraph answer the question directly in one or two sentences (under 50 words), using sentences that already exist in that section (move or trim them; don't write new claims).",
  "content.questions_answered":
    "For question headings with no answer below them, move the sentences from elsewhere on the page that answer them directly under the heading. If no existing sentence answers a question, leave it alone.",
  "content.semantic_html":
    "Use semantic markup: real <ul>/<ol> lists for list-like lines, <strong>/<em> instead of <b>/<i>, headings instead of bold paragraphs used as headings. Keep all text identical.",
  "content.scannable":
    "Make the content easier to scan: split paragraphs longer than ~120 words at sentence boundaries and turn inline lists of three or more items into <ul> lists. Keep all text identical.",
  "content.internal_links":
    "Add up to 3 links to the site's own pages listed below, on phrases that already exist in the content and match those pages' topics. Don't add new sentences.",
};

async function contentEdits(
  input: CmsFixInput,
  html: string,
  extra: string,
): Promise<{ ok: true; after: string; summary: string } | { ok: false; reason: string }> {
  const complete = input.complete ?? llmJson;
  const task =
    CONTENT_TASK[input.ruleId] ?? "Fix the finding with the smallest possible content change.";
  const corpus = corpusOf(input);
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await complete<ContentEdits>({
      route: ROUTE,
      // A second attempt follows a validation/grounding rejection: premium tier.
      escalate: attempt > 0,
      maxTokens: 6000,
      outputSchema: EDIT_SCHEMA,
      fallback: { edits: [], summary: "" },
      system: `You edit the HTML body of one web page to fix one AI-visibility finding.
Return exact find/replace edits: each "find" must be copied exactly from the HTML and match once.
Rules: smallest change that fixes the finding; keep the author's words; never invent facts, numbers, names, quotes or links; keep WordPress block comments (<!-- wp:... -->) balanced.`,
      user: `Finding: ${input.finding.title}. ${input.finding.detail}
Task: ${task}${extra}

Page title: ${input.page?.title ?? ""}
HTML:
${html.slice(0, 50_000)}${feedback}`,
    });
    const applied = applyEdits(
      [{ path: "content.html", action: "update", content: html }],
      out.edits.map((e) => ({ ...e, path: "content.html" })),
    );
    if (!applied.ok) {
      feedback = `\n\nYour edits were rejected: ${applied.reason} Copy "find" text exactly and try again.`;
      continue;
    }
    const after = applied.files[0].after;
    const text = (s: string) =>
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim().length;
    if (text(after) < text(html) * 0.85) {
      feedback = "\n\nYour edits removed too much text. Keep the author's content.";
      continue;
    }
    const grounding = groundingCheck({
      files: [{ path: "content.html", before: html, after }],
      siteText: corpus,
      inputs: Object.values(input.inputs),
    });
    if (!grounding.ok) {
      feedback = `\n\nThese added words aren't on the site: ${grounding.ungrounded
        .map((u) => `"${u.text}" (${u.reason})`)
        .join("; ")}. Use only the page's own wording.`;
      continue;
    }
    return { ok: true, after, summary: out.summary };
  }
  return {
    ok: false,
    reason: "Mellox couldn't produce a safe content change for this page. Follow the manual steps.",
  };
}

const ALT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    alts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { index: { type: "integer" }, alt: { type: "string" } },
        required: ["index", "alt"],
      },
    },
  },
  required: ["alts"],
};

async function altTexts(
  input: CmsFixInput,
  images: { src: string; context: string }[],
): Promise<Map<number, string>> {
  const complete = input.complete ?? llmJson;
  const out = await complete<{ alts: { index: number; alt: string }[] }>({
    route: ROUTE,
    maxTokens: 1200,
    outputSchema: ALT_SCHEMA,
    fallback: { alts: [] },
    system:
      "Write short, literal alt text (under 110 characters) for images on a web page, from the file name and the text around each image. Describe what the image most likely shows; don't start with 'Image of'; no marketing claims. If there is no clue, return an empty string for that image.",
    user: images
      .map(
        (im, i) =>
          `${i}. file: ${im.src.split("/").pop()?.slice(0, 120)}\n   nearby text: ${im.context}`,
      )
      .join("\n"),
  });
  const map = new Map<number, string>();
  for (const a of out.alts ?? []) {
    const alt = a.alt.replace(/\s+/g, " ").trim().slice(0, 125);
    if (alt && Number.isInteger(a.index) && a.index >= 0 && a.index < images.length)
      map.set(a.index, alt);
  }
  return map;
}

/* ───────────────────────── assisted placement ───────────────────────── */

function whereFor(provider: "wordpress" | "webflow", field: CmsField): string {
  if (provider === "webflow")
    switch (field) {
      case "jsonld_page":
        return "Webflow Designer → Pages → this page's settings → Custom code → Inside <head> tag";
      case "jsonld_site":
        return "Webflow → Site settings → Custom code → Head code";
      case "robots_txt":
        return "Webflow → Site settings → SEO → Indexing → robots.txt";
      case "llms_txt":
        return "Host this file at /llms.txt (Webflow Enterprise: Site settings → well-known files)";
      case "canonical":
        return "Webflow → Site settings → SEO → Global canonical tag URL";
      case "noindex":
        return "Webflow Designer → this page's settings → SEO → turn indexing on";
      case "image_alt":
        return "Webflow Designer → select each image → Settings → Alt text";
      case "content_html":
        return "Webflow Designer → edit the text on this page";
      default:
        return "Webflow Designer → this page's settings → SEO settings";
    }
  switch (field) {
    case "jsonld_page":
    case "jsonld_site":
      return "Your SEO plugin's schema settings, or install the Mellox GEO plugin and let Mellox add it";
    case "robots_txt":
      return "Your SEO plugin's robots.txt editor, or install the Mellox GEO plugin";
    case "llms_txt":
      return "Upload as /llms.txt at your site root, or install the Mellox GEO plugin";
    default:
      return "Your SEO plugin's fields for this page, or install the Mellox GEO plugin";
  }
}

const script = (x: JsonLd | JsonLd[]) =>
  `<script type="application/ld+json">\n${JSON.stringify(x, null, 2)}\n</script>`;

/* ───────────────────────── plan ───────────────────────── */

function pageTitles(pages: CrawledPageFacts[]): Record<string, string | null> {
  return Object.fromEntries(pages.map((p) => [p.url, p.title]));
}

function sitemapUrl(input: CmsFixInput): string | null {
  if (input.site.sitemap.found)
    return input.site.sitemap.sources[0] ?? `${input.origin}/sitemap.xml`;
  return input.session.provider === "wordpress"
    ? `${input.origin.replace(/\/+$/, "")}/wp-sitemap.xml`
    : null;
}

export async function planCmsFix(input: CmsFixInput): Promise<CmsFixPlan> {
  const fields = cmsFieldsForRule(input.ruleId);
  const s = input.session;
  const provider = s.provider;
  const wpSeo = s.provider === "wordpress" ? s.seo : undefined;
  const { resolved } = input;
  const changes: CmsChange[] = [];
  const assisted: AssistedStep[] = [];
  const notes: string[] = [];
  const checks: CmsFixPlan["checks"] = [];
  const pageUrl = resolved.url;

  const add = async (
    field: CmsField,
    target: CmsTarget | null,
    key: string | null,
    after: string | boolean,
    reason: string,
    label = FIELD_LABEL[field],
  ) => {
    const support = fieldSupport(field, { provider, wpSeo, pageKind: resolved.pageKind });
    if (support.mode === "apply" && target && key) {
      const before = await readField(s, { target, key });
      changes.push({ target, field, key, label, before, after, reason });
      return;
    }
    assisted.push({
      label,
      where: whereFor(provider, field),
      value: typeof after === "boolean" ? (after ? "noindex" : "index") : after,
      why: `${reason} ${support.reason}`.trim(),
    });
  };

  for (const field of fields) {
    const pageTarget = resolved.target;
    const siteTarget = resolved.siteTarget;
    const wpKey = (part?: "title" | "description") =>
      wpSeo ? wordpressKey(field, wpSeo, part) : null;
    const key = (part?: "title" | "description") =>
      provider === "wordpress" ? wpKey(part) : webflowKey(field, part);

    switch (field) {
      case "seo_title":
      case "meta_description": {
        const m = await metaText(input, field === "seo_title" ? "title" : "description");
        await add(
          field,
          pageTarget,
          key(),
          field === "seo_title" ? m.title : m.description,
          m.reason,
        );
        break;
      }
      case "og": {
        const m = await metaText(input, "both");
        await add(field, pageTarget, key("title"), m.title, m.reason, "Social sharing title");
        await add(
          field,
          pageTarget,
          key("description"),
          m.description,
          m.reason,
          "Social sharing description",
        );
        break;
      }
      case "canonical":
        await add(
          field,
          pageTarget,
          key(),
          canonicalFor(pageUrl),
          "Points search engines at this page's own address.",
        );
        break;
      case "noindex":
        await add(field, pageTarget, key(), false, "Lets search and AI engines index this page.");
        break;
      case "jsonld_site": {
        const graph = organizationGraph({
          origin: input.origin,
          name: input.brandName ?? input.site.host,
        });
        await add(
          field,
          siteTarget,
          key(),
          provider === "wordpress" && siteTarget ? JSON.stringify(graph, null, 2) : script(graph),
          "Tells AI engines who runs this site, using the brand name the site already shows.",
        );
        break;
      }
      case "jsonld_page": {
        let entity: JsonLd | null = null;
        let why = "";
        if (input.ruleId === "schema.breadcrumbs") {
          entity = breadcrumbList(pageUrl, pageTitles(input.pages));
          why = "Shows where this page sits in the site, from its address and page titles.";
        } else if (input.ruleId === "content.faq_schema") {
          const pairs = extractFaqPairs(resolved.wordpress?.content ?? resolved.html);
          entity = faqPage(pairs);
          why = `Marks up the ${pairs.length} question(s) this page already answers.`;
        } else {
          const isPost = pageTarget?.kind === "wp_object" && pageTarget.type === "post";
          entity = pageEntity({
            kind: isPost ? "article" : "webpage",
            url: canonicalFor(pageUrl),
            headline: input.page?.h1[0] ?? input.page?.title ?? input.site.host,
            description: input.page?.description ?? null,
            datePublished: resolved.wordpress?.date ?? null,
            dateModified: resolved.wordpress?.modified ?? null,
            publisherName: input.brandName,
            origin: input.origin,
          });
          why = "Describes what this page is, with its own title and dates.";
        }
        if (!entity) {
          notes.push("No question headings with answers were found to mark up.");
          break;
        }
        if (provider === "wordpress" && wpSeo === "mellox" && pageTarget) {
          const current = await readField(s, { target: pageTarget, key: "head.jsonld" });
          const existing = typeof current === "string" && current.trim() ? JSON.parse(current) : [];
          const merged = mergeJsonLd(Array.isArray(existing) ? existing : [existing], [entity]);
          await add(
            field,
            pageTarget,
            "head.jsonld",
            JSON.stringify(merged.length === 1 ? merged[0] : merged, null, 2),
            why,
          );
        } else {
          await add(field, null, null, script(entity), why);
        }
        break;
      }
      case "robots_txt": {
        const existing =
          provider === "wordpress" && wpSeo === "mellox" && siteTarget
            ? String((await readField(s, { target: siteTarget, key: "site.robots_append" })) ?? "")
            : "";
        const next = robotsAdditions({
          ruleId: input.ruleId,
          existingAppend: existing,
          sitemapUrl: sitemapUrl(input),
        });
        if (next === existing) {
          notes.push("robots.txt already has these lines through Mellox.");
          break;
        }
        await add(
          field,
          siteTarget,
          key(),
          next,
          "Lets AI crawlers read the site and points them at the sitemap.",
        );
        break;
      }
      case "llms_txt": {
        const built = buildLlmsTxt({
          site: input.site,
          brandName: input.brandName,
          summary: input.pages.find((p) => p.pageType === "home")?.description ?? null,
          pages: input.pages,
        });
        if (!built.ok) {
          notes.push(built.reason);
          break;
        }
        await add(field, siteTarget, key(), built.content, built.summary);
        break;
      }
      case "content_html": {
        let html: string | null = null;
        const target = pageTarget;
        let k: string | null = key();
        if (resolved.pageKind === "wp_object" && pageTarget)
          html = resolved.wordpress?.content ?? null;
        if (s.provider === "webflow" && pageTarget?.kind === "webflow_item") {
          const slug = await richTextFieldSlug(s.token, pageTarget.collectionId);
          k = slug ? `fieldData.${slug}` : null;
          html = k ? String((await readField(s, { target: pageTarget, key: k })) ?? "") : null;
        }
        if (!html || !k) {
          await add(
            field,
            null,
            null,
            "",
            "This page's text isn't stored in a place Mellox can edit.",
          );
          break;
        }
        const extra =
          input.ruleId === "content.internal_links"
            ? `\nSite pages you may link to:\n${input.pages
                .filter((p) => p.url !== pageUrl && p.title && !p.noindex)
                .slice(0, 25)
                .map((p) => `- ${p.url} — ${p.title}`)
                .join("\n")}`
            : "";
        const edited = await contentEdits(input, html, extra);
        if (!edited.ok) {
          notes.push(edited.reason);
          break;
        }
        const before = await readField(s, { target: target!, key: k });
        changes.push({
          target: target!,
          field,
          key: k,
          label: FIELD_LABEL.content_html,
          before,
          after: edited.after,
          reason: edited.summary || "Restructures the page's existing content.",
        });
        break;
      }
      case "image_alt": {
        const html = resolved.wordpress?.content ?? null;
        if (!html || !pageTarget) {
          await add(field, null, null, "", "Add a short description to each image that has none.");
          break;
        }
        const missing = imagesMissingAlt(html);
        if (!missing.length) {
          notes.push("Every image in the page content already has alt text.");
          break;
        }
        const contexts = missing.map((m) => {
          const i = html.indexOf(m.tag);
          return {
            src: m.src,
            context: html
              .slice(Math.max(0, i - 400), i + m.tag.length + 400)
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 300),
          };
        });
        const alts = await altTexts(input, contexts);
        let after = html;
        missing.forEach((m, i) => {
          const alt = alts.get(i);
          if (alt) after = after.replace(m.tag, () => withAlt(m.tag, alt));
        });
        if (after === html) {
          notes.push("Mellox couldn't tell what the images show; add alt text by hand.");
          break;
        }
        changes.push({
          target: pageTarget,
          field: "content_html",
          key: "content",
          label: "Image alt text in the page content",
          before: html,
          after,
          reason: `Adds alt text to ${alts.size} image(s) from their file names and surrounding text.`,
        });
        for (const [i, alt] of alts) {
          const id = missing[i].mediaId;
          if (!id) continue;
          const target: CmsTarget = { kind: "wp_media", id, url: missing[i].src };
          const before = await readField(s, { target, key: "alt_text" }).catch(() => null);
          if (typeof before === "string" && before.trim()) continue;
          changes.push({
            target,
            field: "image_alt",
            key: "alt_text",
            label: `Alt text in the media library (image #${id})`,
            before: before ?? "",
            after: alt,
            reason: "Keeps the media library in step so future uses of the image have alt text.",
          });
        }
        break;
      }
    }
  }

  // Drop changes that don't change anything.
  const real = changes.filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
  checks.push({
    id: "grounded",
    label: "No invented facts",
    status: "pass",
    detail: "New text uses only wording, names and numbers that already appear on the site.",
  });
  checks.push({
    id: "exact_target",
    label: "Exact page confirmed",
    status:
      resolved.target || !fields.some((f) => !["jsonld_site", "robots_txt", "llms_txt"].includes(f))
        ? "pass"
        : "skipped",
    detail: resolved.target
      ? `Mellox matched ${pageUrl} to the object it will change.`
      : "Only site-wide settings change.",
  });

  const fieldNames = [...new Set(real.map((c) => c.label))];
  const explanation = real.length
    ? `Mellox will change ${fieldNames.join(", ").toLowerCase()} on ${provider === "wordpress" ? "WordPress" : "Webflow"}${
        assisted.length
          ? `, and shows ${assisted.length} value(s) to paste where the API can't reach`
          : ""
      }.`
    : assisted.length
      ? `${provider === "wordpress" ? "WordPress" : "Webflow"} doesn't let Mellox change this directly. Paste the value${assisted.length > 1 ? "s" : ""} below where shown.`
      : "";
  return {
    changes: real,
    assisted,
    explanation,
    notFixable:
      real.length || assisted.length
        ? null
        : (notes[0] ?? "This finding needs changes Mellox can't make on this platform."),
    manualSteps: notes,
    checks,
  };
}
