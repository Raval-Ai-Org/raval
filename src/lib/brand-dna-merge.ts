// brand-dna-merge.ts — fold a /api/brand-extract result into stored Brand DNA.
//
// The extraction payload is not a BrandDna: it sends `customerSignals` (DNA
// stores `customer`), `insights` (DNA stores `userInsights`), competitors
// without ids, and an `extras` block of crawl evidence. Spreading it straight
// into BrandDna leaves stray keys and drops most of that knowledge, so every
// writer goes through this function.
import { emptyDna, type BrandColor, type BrandDna } from "@/hooks/use-brand-dna";
import type { BrandExtractResult } from "@/lib/brand-extract-events";

export type MergeStats = {
  pages: number;
  competitors: number;
  newInsights: number;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Existing non-empty text fields win over extracted ones, so a re-scan never
 * overwrites what the user wrote. Lists of evidence are merged and de-duped.
 */
export function mergeExtractionIntoDna(
  dna: BrandDna,
  data: BrandExtractResult,
  url: string,
  makeId: () => string = () => crypto.randomUUID(),
): { dna: BrandDna; stats: MergeStats } {
  const now = Date.now();

  const existingCompByName = new Set(dna.competitors.map((c) => c.name.toLowerCase().trim()));
  const competitors = [
    ...dna.competitors,
    ...(data.competitors ?? [])
      .filter((c) => c?.name && !existingCompByName.has(c.name.toLowerCase().trim()))
      .map((c) => ({
        id: makeId(),
        name: c.name,
        url: c.url,
        positioning: c.positioning,
        strengths: c.strengths,
        weaknesses: c.weaknesses,
        notes: c.notes,
      })),
  ].slice(0, 12);

  const cs = data.customerSignals ?? {};
  const customer = {
    ...dna.customer,
    jobsToBeDone: dna.customer.jobsToBeDone || text(cs.jobsToBeDone),
    painPoints: dna.customer.painPoints || text(cs.painPoints),
    objections: dna.customer.objections || text(cs.objections),
    buyingTriggers: dna.customer.buyingTriggers || text(cs.buyingTriggers),
    decisionCriteria: dna.customer.decisionCriteria || text(cs.decisionCriteria),
    channels: dna.customer.channels || text(cs.channels),
    feedback: dna.customer.feedback || text(cs.feedback),
  };

  const existingTitles = new Set(dna.userInsights.map((i) => i.title.toLowerCase().trim()));
  const newInsights = (data.insights ?? [])
    .filter((i) => i?.title && !existingTitles.has(i.title.toLowerCase().trim()))
    .map((i) => ({
      id: makeId(),
      title: i.title,
      body: i.body || "",
      createdAt: now,
      source: "user" as const,
    }));

  const keywords = Array.from(
    new Set([
      ...dna.keywords.map((k) => k.toLowerCase()),
      ...(data.keywords ?? []).filter((k) => typeof k === "string").map((k) => k.toLowerCase()),
    ]),
  )
    .filter(Boolean)
    .slice(0, 20);

  const fill = (current: string, incoming: unknown) =>
    current && current.trim() ? current : text(incoming);

  const existingAssetUrls = new Set(dna.assets.map((a) => a.url));
  const extras = data.extras ?? {};
  const newAssets: BrandDna["assets"] = [];
  const pushAsset = (
    label: string,
    assetUrl: string | null | undefined,
    kind: "logo" | "image" | "link",
  ) => {
    if (!assetUrl || existingAssetUrls.has(assetUrl)) return;
    existingAssetUrls.add(assetUrl);
    newAssets.push({ id: makeId(), label, url: assetUrl, kind });
  };
  pushAsset("Logo", data.logoUrl, "logo");
  pushAsset("Favicon", data.faviconUrl, "image");
  for (const s of data.socials ?? []) pushAsset(s.platform || "Social", s.url, "link");

  const summaryBits: string[] = [];
  if (extras.pagesCrawled?.length) summaryBits.push(`Crawled ${extras.pagesCrawled.length} pages.`);
  if (extras.emails?.length) summaryBits.push(`Emails: ${extras.emails.slice(0, 3).join(", ")}.`);
  if (extras.phones?.length) summaryBits.push(`Phones: ${extras.phones.slice(0, 2).join(", ")}.`);
  if (extras.externalMentions?.length)
    summaryBits.push(`${extras.externalMentions.length} external mentions captured.`);
  const summaryNote = summaryBits.length
    ? [
        {
          id: makeId(),
          title: `Website extraction — ${new Date(now).toLocaleDateString()}`,
          body: summaryBits.join(" "),
          createdAt: now,
          source: "manual" as const,
        },
      ]
    : [];

  const existingFeedback = new Set(
    dna.customer.feedbackSources.map((s) => s.text.toLowerCase().trim()),
  );
  const newFeedbackSources = (extras.externalMentions ?? [])
    .filter((m) => m.bucket === "Reviews/Feedback" && m.snippet)
    .filter((m) => !existingFeedback.has(m.snippet.toLowerCase().trim()))
    .slice(0, 8)
    .map((m) => ({
      id: makeId(),
      text: m.snippet,
      sourceLabel: m.title || "Web mention",
      sourceUrl: m.url,
      capturedAt: now,
    }));

  const merged: BrandDna = {
    ...emptyDna,
    ...dna,
    websiteUrl: url,
    brandName: fill(dna.brandName, data.brandName),
    oneLiner: fill(dna.oneLiner, data.oneLiner),
    about: fill(dna.about, data.about),
    industry: fill(dna.industry, data.industry),
    businessModel: fill(dna.businessModel, data.businessModel),
    audience: fill(dna.audience, data.audience),
    voice: fill(dna.voice, data.voice),
    values: fill(dna.values, data.values),
    products: fill(dna.products, data.products),
    doRules: fill(dna.doRules, data.doRules),
    dontRules: fill(dna.dontRules, data.dontRules),
    mission: fill(dna.mission, data.mission),
    vision: fill(dna.vision, data.vision),
    positioning: fill(dna.positioning, data.positioning),
    uniqueValueProp: fill(dna.uniqueValueProp, data.uniqueValueProp),
    colors: (data.colors?.length ? data.colors : dna.colors) as BrandColor[],
    fonts: data.fonts?.length ? data.fonts : dna.fonts,
    logoUrl: data.logoUrl ?? dna.logoUrl,
    faviconUrl: data.faviconUrl ?? dna.faviconUrl,
    audienceTags: data.audienceTags?.length ? data.audienceTags : dna.audienceTags,
    valueTags: data.valueTags?.length ? data.valueTags : dna.valueTags,
    socials: data.socials?.length ? data.socials : dna.socials,
    keywords,
    competitors,
    customer: {
      ...customer,
      feedbackSources: [...dna.customer.feedbackSources, ...newFeedbackSources],
    },
    assets: [...dna.assets, ...newAssets].slice(0, 60),
    notes: [...summaryNote, ...dna.notes].slice(0, 50),
    userInsights: [...newInsights, ...dna.userInsights].slice(0, 80),
    sources: { ...(dna.sources ?? {}), ...(data.sources ?? {}) },
    missing: Array.isArray(data.missing) ? data.missing : dna.missing,
    status: "ok",
    lastError: null,
    extractedAt: now,
  };

  return {
    dna: merged,
    stats: {
      pages: extras.pagesCrawled?.length ?? 1,
      competitors: competitors.length,
      newInsights: newInsights.length,
    },
  };
}
