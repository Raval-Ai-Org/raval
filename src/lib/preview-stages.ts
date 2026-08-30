// Preview stage system — drives the "what's happening" view in SitePreview.
// Inspired by Lovable's in-chat process view and Manus's live task surface.
//
// A "plan" is an ordered list of stages. Each stage has a kind that maps to a
// dedicated visual in <PreviewStage/>. We tick through them on a timer while
// the AI streams, and emit a `preview:stage` window event for the preview to
// pick up. When the caller signals completion, we jump to the `complete` stage
// and then idle.

export type StageKind =
  | "thinking"
  | "searching"
  | "browsing"
  | "analyzing"
  | "extracting"
  | "drafting"
  | "image"
  | "scheduling"
  | "optimizing"
  | "publishing"
  | "complete";

export interface PreviewStage {
  kind: StageKind;
  label: string; // headline ("Analyzing your site")
  sub?: string; // sub-line ("Scanning hero, nav, CTAs…")
  hue?: number; // accent hue (HSL)
  data?: {
    query?: string;
    results?: { title: string; url: string; snippet?: string }[];
    siteUrl?: string;
    screenshotUrl?: string;
    tabs?: { url: string; title: string; favicon?: string }[];
    rows?: { label: string; value: string }[];
    draftTitle?: string;
    draftLines?: string[];
    draftKind?: "instagram" | "tweet" | "linkedin" | "blog" | "email";
    imagePrompt?: string;
    imageAspect?: "1:1" | "4:5" | "16:9";
    channels?: string[]; // social channels for scheduling
    metric?: { label: string; from: number; to: number; unit?: string }[];
  };
}

export interface PreviewStageEvent extends PreviewStage {
  index: number;
  total: number;
}

const EV = "preview:stage";
const IDLE = "preview:idle";
const CTX = "preview:context";

/* ── Live context store ───────────────────────────────────────────────────
 * The preview surface (SitePreview) registers what it currently has access
 * to — site URL, live screenshot URL, favicon. Stages read this so visuals
 * use the user's REAL site rather than placeholders. */
export interface PreviewContext {
  siteUrl?: string | null;
  screenshotUrl?: string | null;
  brand?: string | null;
}
let previewContext: PreviewContext = {};
export function setPreviewContext(ctx: PreviewContext) {
  previewContext = { ...previewContext, ...ctx };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<PreviewContext>(CTX, { detail: previewContext }));
  }
}
export function getPreviewContext(): PreviewContext {
  return previewContext;
}

function dispatch(stage: PreviewStage, index: number, total: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PreviewStageEvent>(EV, { detail: { ...stage, index, total } }),
  );
}

function dispatchIdle() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(IDLE));
}

// ── Intent planner ────────────────────────────────────────────────────────

const KEYWORDS = {
  search: /\b(search|find|look up|reddit|quora|forum|thread|serp|keyword)\b/i,
  audit: /\b(audit|scan|analy[sz]e|crawl|inspect|review|seo|aeo|geo)\b/i,
  competitor: /\b(competitor|competition|rival|vs\.?|versus|compare)\b/i,
  draft: /\b(draft|write|blog|article|post|copy|email|caption|brief|outline)\b/i,
  image: /\b(image|visual|banner|thumbnail|graphic|poster|creative|photo)\b/i,
  schedule: /\b(schedule|post to|publish|tweet|share|calendar|queue)\b/i,
  insta: /\b(insta(gram)?|reel|story|ig)\b/i,
  tweet: /\b(tweet|twitter|\bx\b post|thread)\b/i,
  linkedin: /\b(linkedin|li post)\b/i,
  email_: /\b(email|newsletter|subject line)\b/i,
  blog: /\b(blog|article|long.?form)\b/i,
};

function pickHue(kind: StageKind): number {
  switch (kind) {
    case "searching":
      return 217;
    case "browsing":
      return 195;
    case "analyzing":
      return 200;
    case "extracting":
      return 175;
    case "drafting":
      return 38;
    case "image":
      return 320;
    case "scheduling":
      return 270;
    case "optimizing":
      return 0;
    case "publishing":
      return 142;
    case "complete":
      return 150;
    default:
      return 260;
  }
}

function extractUrls(p: string): string[] {
  const re = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/gi;
  return Array.from(new Set((p.match(re) ?? []).map((s) => s.replace(/[.,)]$/, ""))));
}

function detectDraftKind(p: string): NonNullable<PreviewStage["data"]>["draftKind"] {
  if (KEYWORDS.insta.test(p)) return "instagram";
  if (KEYWORDS.tweet.test(p)) return "tweet";
  if (KEYWORDS.linkedin.test(p)) return "linkedin";
  if (KEYWORDS.email_.test(p)) return "email";
  if (KEYWORDS.blog.test(p)) return "blog";
  return "blog";
}

export function planFromPrompt(
  prompt: string,
  ctx: { siteUrl?: string | null; brand?: string | null } = {},
): PreviewStage[] {
  const p = prompt.toLowerCase();
  const brand = ctx.brand || hostFromUrl(ctx.siteUrl) || "your brand";
  const q = prompt.replace(/[?.!]+$/, "").slice(0, 64);
  const mentionedUrls = extractUrls(prompt).filter(
    (u) => hostFromUrl(u) !== hostFromUrl(ctx.siteUrl),
  );

  const stages: PreviewStage[] = [
    {
      kind: "thinking",
      label: "Thinking it through",
      sub: q ? `"${q}"` : undefined,
      hue: pickHue("thinking"),
    },
  ];

  const did = new Set<StageKind>();
  const add = (s: PreviewStage) => {
    if (!did.has(s.kind)) {
      stages.push({ ...s, hue: s.hue ?? pickHue(s.kind) });
      did.add(s.kind);
    }
  };

  // Competitor / explicit URL analysis → browse THEN extract
  if (KEYWORDS.competitor.test(p) || mentionedUrls.length) {
    const targets = mentionedUrls.length ? mentionedUrls : [`${brand}.com`];
    const tabs = targets.slice(0, 4).map((u) => ({
      url: hostFromUrl(u) ?? u,
      title: `${titleCase(hostFromUrl(u) ?? u)} — homepage`,
    }));
    // Add a couple of comparison sources
    tabs.push(
      { url: `g2.com/compare`, title: "G2 · side-by-side comparison" },
      { url: `reddit.com/r/saas`, title: `Reddit threads mentioning ${brand}` },
    );
    add({
      kind: "browsing",
      label: mentionedUrls.length ? `Browsing ${tabs[0].url}` : "Browsing competitors",
      sub: `${tabs.length} sources · live`,
      data: { tabs, siteUrl: targets[0] },
    });
    add({
      kind: "extracting",
      label: "Extracting signals",
      sub: "Pricing · positioning · CTAs · social proof",
      data: {
        rows: [
          { label: "Pricing model", value: "Tiered · from $29/mo" },
          { label: "Primary CTA", value: "Start free trial" },
          { label: "Hero promise", value: "Ship 10× faster" },
          { label: "Social proof", value: "4.6 ★ G2 · 128 reviews" },
          { label: "Top keyword", value: "ai marketing platform" },
        ],
      },
    });
  }

  if (KEYWORDS.search.test(p)) {
    add({
      kind: "searching",
      label: "Searching the web",
      sub: `Looking for "${brand}" mentions`,
      data: {
        query: brand,
        results: mockResults(brand),
      },
    });
  }

  if (KEYWORDS.audit.test(p) || (!did.size && ctx.siteUrl)) {
    add({
      kind: "analyzing",
      label: "Analyzing your site",
      sub: "Hero · nav · CTAs · meta tags",
      data: { siteUrl: ctx.siteUrl ?? undefined },
    });
  }

  if (KEYWORDS.image.test(p)) {
    const aspect: "1:1" | "4:5" | "16:9" = KEYWORDS.insta.test(p)
      ? "4:5"
      : KEYWORDS.tweet.test(p)
        ? "16:9"
        : "1:1";
    add({
      kind: "image",
      label: "Generating visual",
      sub: "On-brand composition",
      data: { imagePrompt: q, imageAspect: aspect },
    });
  }

  if (KEYWORDS.draft.test(p)) {
    const kind = detectDraftKind(p);
    add({
      kind: "drafting",
      label: kind === "blog" ? "Drafting article" : `Drafting ${kind} post`,
      sub: "On voice · on brand",
      data: {
        draftTitle: titleCase(q || `${brand} update`),
        draftLines: mockDraft(brand, kind),
        draftKind: kind,
      },
    });
  }

  if (KEYWORDS.schedule.test(p)) {
    add({
      kind: "scheduling",
      label: "Picking the best time",
      sub: "Across your active channels",
      data: { channels: ["Instagram", "LinkedIn", "X", "TikTok"] },
    });
  }

  // Fallback: nothing matched → think → analyze (or just think)
  if (stages.length === 1) {
    add({
      kind: "analyzing",
      label: "Mapping the request",
      sub: "Routing to the right agents",
      data: { siteUrl: ctx.siteUrl ?? undefined },
    });
  }

  // Enrich every stage with live preview context (real screenshot/site URL).
  return stages.map((s) => ({
    ...s,
    data: {
      ...s.data,
      siteUrl: s.data?.siteUrl ?? previewContext.siteUrl ?? undefined,
      screenshotUrl: s.data?.screenshotUrl ?? previewContext.screenshotUrl ?? undefined,
    },
  }));
}

// Re-export helper for visuals.
export { hostFromUrl };

// ── Controller ────────────────────────────────────────────────────────────

interface ActivePlan {
  stages: PreviewStage[];
  index: number;
  timer: number | null;
  completed: boolean;
}

let activePlan: ActivePlan | null = null;

/** Start a plan. Stages tick at ~3s intervals; the last stage holds. */
export function startPreviewPlan(stages: PreviewStage[]) {
  stopPreviewPlan(true);
  if (!stages.length) return;
  activePlan = { stages, index: 0, timer: null, completed: false };
  dispatch(stages[0], 0, stages.length);
  scheduleNext();
}

function scheduleNext() {
  if (!activePlan || typeof window === "undefined") return;
  const dur = 2800;
  activePlan.timer = window.setTimeout(() => {
    if (!activePlan) return;
    const nextIdx = Math.min(activePlan.index + 1, activePlan.stages.length - 1);
    if (nextIdx === activePlan.index) return; // hold on last
    activePlan.index = nextIdx;
    dispatch(activePlan.stages[nextIdx], nextIdx, activePlan.stages.length);
    if (nextIdx < activePlan.stages.length - 1) scheduleNext();
  }, dur);
}

/** Signal completion — shows a success stage, then idles. */
export function completePreviewPlan(label = "All done", sub?: string) {
  if (!activePlan) return;
  stopPreviewPlan(false);
  const done: PreviewStage = { kind: "complete", label, sub, hue: pickHue("complete") };
  dispatch(done, 0, 1);
  if (typeof window !== "undefined") {
    window.setTimeout(dispatchIdle, 1600);
  }
}

/** Cancel any active plan. */
export function stopPreviewPlan(silent = false) {
  if (activePlan?.timer && typeof window !== "undefined") {
    window.clearTimeout(activePlan.timer);
  }
  activePlan = null;
  if (!silent) dispatchIdle();
}

// ── helpers ───────────────────────────────────────────────────────────────

function hostFromUrl(url?: string | null) {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function mockResults(brand: string) {
  return [
    {
      title: `${titleCase(brand)} — official site`,
      url: `${brand}.com`,
      snippet: "Homepage · About · Pricing",
    },
    {
      title: `r/marketing discussion on ${brand}`,
      url: `reddit.com/r/marketing`,
      snippet: "12 comments · 4d ago",
    },
    {
      title: `${titleCase(brand)} reviews on G2`,
      url: `g2.com/products/${brand}`,
      snippet: "4.6 ★ · 128 reviews",
    },
    {
      title: `Best alternatives to ${brand} (2026)`,
      url: `producthunt.com`,
      snippet: "Curated list · trending",
    },
  ];
}

function mockDraft(brand: string, kind: NonNullable<PreviewStage["data"]>["draftKind"] = "blog") {
  const b = titleCase(brand);
  if (kind === "instagram") {
    return [
      `✨ Big news from ${b}`,
      ``,
      `We just shipped the feature you've been asking for.`,
      `Tap the link in bio to try it today →`,
      ``,
      `#marketing #growth #ai`,
    ];
  }
  if (kind === "tweet") {
    return [
      `${b} just shipped something we're proud of.`,
      ``,
      `→ 10× faster setup`,
      `→ Zero config`,
      `→ Works with your stack`,
      ``,
      `Try it free.`,
    ];
  }
  if (kind === "linkedin") {
    return [
      `A quick update from the ${b} team —`,
      ``,
      `For the last 3 months we've been heads-down`,
      `rebuilding how marketers ship campaigns.`,
      ``,
      `Here's what changed, and why it matters →`,
    ];
  }
  if (kind === "email") {
    return [
      `Subject: A faster way to ship campaigns`,
      ``,
      `Hi {{first_name}},`,
      ``,
      `If you've ever waited days for a campaign to go live,`,
      `you'll like what we just shipped.`,
    ];
  }
  return [
    `# Why ${b} matters in 2026`,
    ``,
    `The bar for marketing teams keeps rising. Buyers expect`,
    `personal, fast, and trustworthy experiences — at scale.`,
    ``,
    `Here's how ${b} is rewriting the playbook…`,
  ];
}

// ── React hook ────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

export function usePreviewStage() {
  const [stage, setStage] = useState<PreviewStageEvent | null>(null);
  useEffect(() => {
    const onStage = (e: Event) => setStage((e as CustomEvent<PreviewStageEvent>).detail);
    const onIdle = () => setStage(null);
    window.addEventListener(EV, onStage as EventListener);
    window.addEventListener(IDLE, onIdle);
    return () => {
      window.removeEventListener(EV, onStage as EventListener);
      window.removeEventListener(IDLE, onIdle);
    };
  }, []);
  return stage;
}
