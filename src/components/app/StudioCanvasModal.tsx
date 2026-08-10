import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { X, Sparkles, Send, Wand2, Play, Image as ImageIcon, Check, Zap, AlertTriangle, Repeat } from "@/components/brand/icons";
import { PromptInspector } from "@/components/app/PromptInspector";

import { cn } from "@/lib/utils";
import { MOCK_APPROVALS, TILE_BY_ID, type CanvasType } from "@/lib/studio";
import type { CanvasState } from "@/hooks/use-studio";
import { tintFor } from "./StudioRail";
import { authedFetch } from "@/lib/authed-fetch";
import { createContentItem, updateContentItem } from "@/lib/content.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { genQueue, newJobId } from "@/lib/generation-queue";
import { PLATFORMS, PLATFORM_ORDER, DEFAULT_PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { publishContentItems, scheduleContentItems } from "@/lib/sdr.functions";
import { StudioDestinationPicker } from "@/components/app/StudioDestinationPicker";
import { DeliveryView } from "@/components/app/DeliveryView";
import type { PublishSelection } from "@/lib/sdr.handlers";

type SocialVariant = { platform: PlatformId; title: string; body: string; hashtags: string[]; chars: number };

const EASE = [0.22, 1, 0.36, 1] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TASK_BY_CANVAS: Record<CanvasType, "social-post" | "content-gen" | "crm-message" | "seo-audit"> = {
  "social-post": "social-post",
  "seo-brief": "seo-audit",
  "landing-page": "content-gen",
  email: "crm-message",
  article: "content-gen",
  "design-asset": "social-post",
};

const CHANNEL_BY_CANVAS: Record<CanvasType, string> = {
  "social-post": "linkedin",
  "seo-brief": "web",
  "landing-page": "web",
  email: "email",
  article: "blog",
  "design-asset": "instagram",
};

const KIND_BY_CANVAS: Record<CanvasType, "post" | "brief" | "email" | "landing" | "blog"> = {
  "social-post": "post",
  "seo-brief": "brief",
  "landing-page": "landing",
  email: "email",
  article: "blog",
  "design-asset": "post",
};

type ImgSize = "1024x1024" | "1792x1024" | "1024x1792";
const OPTIMAL_SIZE_BY_PLATFORM: Record<PlatformId, ImgSize> = {
  linkedin: "1792x1024",   // landscape performs best in-feed
  twitter: "1792x1024",    // 16:9 card
  facebook: "1792x1024",   // landscape
  instagram: "1024x1024",  // square feed default
  threads: "1024x1024",
  tiktok: "1024x1792",     // 9:16 vertical
  youtube: "1792x1024",    // thumbnail 16:9
};
const sizeForPlatform = (p: PlatformId): ImgSize => OPTIMAL_SIZE_BY_PLATFORM[p] ?? "1024x1024";

type BrandDnaLite = {
  brandName?: string;
  oneLiner?: string;
  voice?: string;
  audience?: string;
  values?: string;
  products?: string;
  doRules?: string;
  dontRules?: string;
  websiteUrl?: string | null;
  industry?: string;
};

function loadBrandDna(workspaceId?: string | null): BrandDnaLite | null {
  if (!workspaceId || typeof window === "undefined") return null;
  const keys = [`brand-dna:v3:${workspaceId}`, `brand-dna:v2:${workspaceId}`, `brand-dna:${workspaceId}`];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return JSON.parse(raw) as BrandDnaLite;
    } catch {}
  }
  return null;
}

function brandContextString(b: BrandDnaLite | null, workspaceName?: string): string {
  if (!b) return workspaceName ? `Brand: ${workspaceName}` : "";
  const parts: string[] = [];
  if (b.brandName || workspaceName) parts.push(`Brand: ${b.brandName || workspaceName}`);
  if (b.oneLiner) parts.push(`One-liner: ${b.oneLiner}`);
  if (b.industry) parts.push(`Industry: ${b.industry}`);
  if (b.products) parts.push(`Products / offer: ${b.products}`);
  if (b.audience) parts.push(`Audience: ${b.audience}`);
  if (b.voice) parts.push(`Voice: ${b.voice}`);
  if (b.values) parts.push(`Values: ${b.values}`);
  if (b.doRules) parts.push(`Do: ${b.doRules}`);
  if (b.dontRules) parts.push(`Don't: ${b.dontRules}`);
  if (b.websiteUrl) parts.push(`Website: ${b.websiteUrl}`);
  return parts.join("\n");
}

function seedPrompt(type: CanvasType, b: BrandDnaLite | null, workspaceName?: string): string {
  const brand = b?.brandName || workspaceName || "our brand";
  const audience = b?.audience ? ` for ${b.audience}` : "";
  switch (type) {
    case "social-post":
      return `Write a LinkedIn post${audience} about ${brand}. Open with a sharp hook in our voice, give 3 concrete points or proof, end with one question.`;
    case "seo-brief":
      return `Create an SEO + AEO brief for a pillar page${audience} about ${brand}'s core offer. Include target query, search intent, AEO answer snippet (≤55 words), 5 H2s, and 3 internal link ideas.`;
    case "landing-page":
      return `Draft landing page copy for ${brand}'s main offer: hero (H1 + sub), 3 proof points, 3 feature blocks with benefit-led H3s, FAQ (4), and a strong primary CTA${audience}.`;
    case "email":
      return `Write a lifecycle email from ${brand}${audience}: subject (≤55c), preview text, 90-word body in our voice, and one clear CTA.`;
    case "article":
      return `Draft a 700-word blog intro + outline for ${brand}${audience}. Topic should fit our offer. Provide H2 sections, key takeaways, and a closing CTA.`;
    case "design-asset":
      return `A premium, on-brand social visual for ${brand}${audience}. Describe the subject, mood, and the single message the image should reinforce — the caption is written after the image is generated.`;
  }
}

function brandFallbackCopy(type: CanvasType, b: BrandDnaLite | null, workspaceName?: string, sourceTitle?: string): string {
  const brand = b?.brandName || workspaceName || "this brand";
  const offer = b?.products || b?.oneLiner || "the offer customers already care about";
  const audience = b?.audience || "the right customers";
  const voice = b?.voice ? ` Tone: ${b.voice}.` : "";
  const angle = sourceTitle ? `Angle: ${sourceTitle}.` : `Focus: ${offer}.`;

  if (type === "seo-brief") {
    return `# SEO + AEO brief: ${brand}\n\n**Target query:** ${offer}\n**Audience:** ${audience}\n**Intent:** Learn why ${brand} is relevant and what next step to take.\n\n## Answer snippet\n${brand} helps ${audience} with ${offer}. The page should explain the problem, prove the outcome, and guide readers to a clear next action.\n\n## Recommended H2s\n- What ${audience} need to know first\n- How ${brand} solves the core problem\n- Proof points and practical examples\n- Common questions before choosing\n- Next step / CTA\n\n${angle}${voice}`;
  }

  if (type === "email") {
    return `**Subject:** A practical next step from ${brand}\n**Preview:** Built for ${audience}.\n\nHi,\n\nIf ${audience} are looking for a clearer way to move forward, ${brand} can help with ${offer}.\n\nThis is a simple, useful reminder to focus on the outcome: make the next decision easier, faster, and more aligned with what your customers actually need.\n\nCTA: Review the plan and choose the next best action.\n\n${voice}`;
  }

  if (type === "landing-page") {
    return `# ${brand}\n\n${b?.oneLiner || `A focused solution for ${audience}.`}\n\n## Why it matters\n${brand} helps ${audience} turn ${offer} into a clearer customer journey.\n\n## What to show\n- The main problem your audience wants solved\n- The offer and proof behind it\n- A direct CTA that makes the next step obvious\n\n**CTA:** Start with ${brand}.`;
  }

  if (type === "article") {
    return `# What ${audience} should know about ${offer}\n\n${brand} has a clear opportunity to educate the market with practical, specific content. This article should open with the audience's current challenge, explain the core idea behind ${offer}, and show how ${brand} helps them move from confusion to action.\n\n## Outline\n- The current challenge\n- What changes when the right solution is in place\n- How ${brand} approaches it\n- Key takeaways\n- Next step`;
  }

  return `${sourceTitle ? `${sourceTitle}\n\n` : ""}${brand} is built for ${audience}.\n\nThe next post should make the value clear: ${offer}.\n\nHere’s the point to remember — when the message is specific, useful, and easy to act on, the right people know why they should pay attention.\n\nWhat would you want your audience to do next?\n\n#${brand.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18)} #marketing #growth`;
}

function textFromPayload(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "";
  const direct = ["body", "caption", "summary", "text", "content", "copy", "description"];
  for (const key of direct) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const nested = ["draft", "post", "item"];
  for (const key of nested) {
    const value = payload[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = textFromPayload(value as Record<string, unknown>);
      if (found) return found;
    }
  }
  return "";
}

export function StudioCanvasModal({
  canvas, onClose, workspaceName, workspaceId,
}: { canvas: CanvasState; onClose: () => void; workspaceName?: string; workspaceId?: string | null }) {
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [progress, setProgress] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const progressRef = useRef<number | null>(null);
  const createItem = useServerFn(createContentItem);
  const runUpdate = useServerFn(updateContentItem);
  const draftIdsRef = useRef<string[]>([]);
  const persistDraftsRef = useRef<((args: { canvasType: CanvasType; text?: string; variants?: SocialVariant[]; sourceTitle?: string }) => Promise<void>) | null>(null);
  const runCaptionsRef = useRef<((plats: PlatformId[], brief: string) => Promise<void>) | null>(null);
  const generateDraftRef = useRef<((c: NonNullable<CanvasState>, p: string, t?: string) => Promise<string>) | null>(null);
  const generatePostImageRef = useRef<((brief?: string) => Promise<void>) | null>(null);
  const autoRunKeyRef = useRef<string | null>(null);

  const brand = useMemo(() => loadBrandDna(workspaceId), [workspaceId, canvas?.id]);

  const isSocial = canvas?.type === "social-post" || canvas?.type === "design-asset";
  // US4: the persisted content item id to show delivery for (per-platform status
  // + live links). Only social items that already have a content_item row.
  const deliveryContentItemId = canvas?.id ?? null;
  const [platforms, setPlatforms] = useState<PlatformId[]>(DEFAULT_PLATFORMS);
  const [variants, setVariants] = useState<SocialVariant[]>([]);
  const [publishSelection, setPublishSelection] = useState<PublishSelection>({ type: "all" });
  const [activePlatform, setActivePlatform] = useState<PlatformId>(DEFAULT_PLATFORMS[0]);
  // Explicit review gate — user must confirm captions before Publish/Schedule enable.
  const [captionsConfirmed, setCaptionsConfirmed] = useState(false);
  // Track which platforms the user has personally edited (vs untouched AI draft).
  const [editedPlatforms, setEditedPlatforms] = useState<Partial<Record<PlatformId, boolean>>>({});

  // One shared image per TOPIC — cached per (canvas.id + size) so switching
  // platforms or aspect never triggers a new generation for an already-rendered
  // combination. Only an explicit Generate/Regenerate click spends a credit.
  const [postImage, setPostImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<"1024x1024" | "1792x1024" | "1024x1792">("1024x1024");
  const [autoSize, setAutoSize] = useState(true);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageStatus, setImageStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageProgress, setImageProgress] = useState(0);
  const [imageAttempt, setImageAttempt] = useState(0);
  const imageAbortRef = useRef<AbortController | null>(null);
  const imageProgressTimerRef = useRef<number | null>(null);

  // Per-platform caption stage — powers the multi-stage progress strip and
  // per-platform retry buttons. Populated by runCaptions() below.
  const [captionStatus, setCaptionStatus] = useState<Partial<Record<PlatformId, "idle" | "loading" | "success" | "error">>>({});
  const [captionErrors, setCaptionErrors] = useState<Partial<Record<PlatformId, string>>>({});

  // Cache: { [canvasId]: { [size]: dataUrl } }. Session-scoped so returning
  // to the same topic in the same tab restores previews without re-billing.
  const imageCacheRef = useRef<Record<string, Partial<Record<typeof imageSize, string>>>>({});
  const cacheStorageKey = "studio:image-cache:v1";

  // Hydrate cache from sessionStorage once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(cacheStorageKey);
      if (raw) imageCacheRef.current = JSON.parse(raw);
    } catch {}
  }, []);

  const persistCache = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(cacheStorageKey, JSON.stringify(imageCacheRef.current));
    } catch {
      // Quota exceeded — drop cache for other topics before retrying.
      const only = canvas?.id ? { [canvas.id]: imageCacheRef.current[canvas.id] } : {};
      imageCacheRef.current = only as typeof imageCacheRef.current;
      try { window.sessionStorage.setItem(cacheStorageKey, JSON.stringify(only)); } catch {}
    }
  }, [canvas?.id]);

  // When the topic or size changes, hydrate from cache instead of clearing.
  useEffect(() => {
    const id = canvas?.id;
    imageAbortRef.current?.abort();
    if (imageProgressTimerRef.current) window.clearInterval(imageProgressTimerRef.current);
    setImageLoading(false);
    setImageError(null);
    setImageProgress(0);
    const cached = id ? imageCacheRef.current[id]?.[imageSize] : undefined;
    if (cached) {
      setPostImage(cached);
      setImageStatus("idle"); // cached hit — no "1 credit used" flash
    } else {
      setPostImage(null);
      setImageStatus("idle");
    }
  }, [canvas?.id, imageSize]);

  // Auto-follow active platform's optimal size (single image per topic — user still
  // clicks Generate/Regenerate to spend a credit; changing tabs never auto-generates).
  useEffect(() => {
    if (!autoSize) return;
    const target = sizeForPlatform(activePlatform);
    setImageSize((prev) => (prev === target ? prev : target));
  }, [autoSize, activePlatform]);

  const generatePostImage = useCallback(async (overrideBrief?: string) => {
    if (imageLoading) return;
    const anyVariant = variants[0];
    const bodyForPrompt = (overrideBrief || anyVariant?.body || result || prompt).trim();
    if (!bodyForPrompt) {
      toast.error("Describe the visual first");
      return;
    }


    // --- Extract the visual "hook" from the post copy ---------------------
    // We give the image model the strongest 1-2 lines from the post so the
    // visual reinforces the message instead of guessing from the whole draft.
    const firstLine = bodyForPrompt.split(/\n+/).find((l) => l.trim().length > 0)?.trim() ?? "";
    const hook = firstLine.slice(0, 180);
    const bodySnippet = bodyForPrompt.slice(0, 420);

    // --- Brand DNA → concise visual direction -----------------------------
    const brandName = brand?.brandName || workspaceName || "the brand";
    const voice = brand?.voice?.slice(0, 120);
    const values = brand?.values?.slice(0, 120);
    const audience = brand?.audience?.slice(0, 120);
    const industry = brand?.industry?.slice(0, 80);
    const offer = brand?.products?.slice(0, 140) || brand?.oneLiner?.slice(0, 140);
    const dontRules = brand?.dontRules?.slice(0, 160);

    // Stable visual style "seed" per topic — same seed across every size so
    // 1:1 / 16:9 / 9:16 renders feel like the same campaign, not 3 unrelated
    // images. Derived from brand + canvas id (not from imageSize).
    // Include the attempt count so a "Regenerate" click produces a visibly
    // different variant instead of re-rolling the same deterministic seed.
    // Caption drafts stay untouched (see the !variants.length guard below).
    const regenNonce = imageAttempt + 1;
    const styleSeedBasis = `${brandName}|${industry || ""}|${voice || ""}|${canvas?.id || ""}|v${regenNonce}`;
    let seedHash = 0;
    for (let i = 0; i < styleSeedBasis.length; i++) {
      seedHash = (seedHash * 31 + styleSeedBasis.charCodeAt(i)) | 0;
    }
    const paletteHint = [
      "cool editorial palette with a single warm accent",
      "warm neutral palette with a bold contrast pop",
      "high-contrast monochrome with one saturated accent color",
      "soft pastel gradient with crisp typographic accents",
      "deep midnight background with luminous highlights",
    ][Math.abs(seedHash) % 5];
    const compositionHint = [
      "off-center subject, generous negative space",
      "centered hero subject, symmetric framing",
      "rule-of-thirds layout with layered depth",
      "flat editorial layout with clear focal point",
    ][Math.abs(seedHash >> 3) % 4];

    const aspectLine =
      imageSize === "1024x1024" ? "Square 1:1 composition, safe margins on all sides."
      : imageSize === "1792x1024" ? "Landscape 16:9 composition, subject weighted toward the left third, right third reserved as breathing room."
      : "Portrait 9:16 composition, vertical stack, subject in the upper two-thirds.";

    const platformLine = autoSize
      ? `Optimized for ${PLATFORMS[activePlatform]?.label ?? activePlatform} feed context.`
      : "";

    const visualPrompt = [
      `Design one premium, on-brand social image for ${brandName}${industry ? ` (${industry})` : ""}.`,
      "",
      "BRAND DNA:",
      offer && `• Offer: ${offer}`,
      audience && `• Audience: ${audience}`,
      voice && `• Voice: ${voice}`,
      values && `• Values: ${values}`,
      "",
      "POST MESSAGE (visual must reinforce this — not describe it literally):",
      hook && `• Hook: "${hook}"`,
      `• Draft: ${bodySnippet}`,
      "",
      "VISUAL SYSTEM (keep consistent across every size for this topic):",
      `• Palette: ${paletteHint}`,
      `• Composition: ${compositionHint}`,
      "• Feel: modern, editorial, confident, premium — not stock-photo, not clip-art, not AI-generic.",
      "• Typography: if any text appears, keep it to a short, real phrase from the post hook — no lorem ipsum, no gibberish, no repeated letters.",
      "• No watermarks, no logos of other companies, no brand marks unless it's the brand's own name.",
      dontRules && `• Brand rules to avoid: ${dontRules}`,
      "",
      aspectLine,
      platformLine,
    ].filter(Boolean).join("\n");

    imageAbortRef.current?.abort();
    const ctrl = new AbortController();
    imageAbortRef.current = ctrl;
    setImageLoading(true);
    setImageStatus("loading");
    setImageError(null);
    setImageProgress(6);
    setImageAttempt((n) => n + 1);
    setPostImage(null);

    if (imageProgressTimerRef.current) window.clearInterval(imageProgressTimerRef.current);
    imageProgressTimerRef.current = window.setInterval(() => {
      setImageProgress((p) => (p < 92 ? p + Math.max(1, Math.round((94 - p) * 0.06)) : p));
    }, 220) as unknown as number;

    try {
      const { streamImage } = await import("@/lib/streamImage");
      await streamImage(visualPrompt, (dataUrl, isFinal) => {
        setPostImage(dataUrl);
        if (isFinal) {
          setImageProgress(100);
          setImageLoading(false);
          setImageStatus("success");
          if (imageProgressTimerRef.current) window.clearInterval(imageProgressTimerRef.current);
          // Cache under (canvas.id, size) so switching platforms/aspects rehydrates for free.
          const id = canvas?.id;
          if (id) {
            imageCacheRef.current[id] = { ...(imageCacheRef.current[id] || {}), [imageSize]: dataUrl };
            persistCache();
          }
          toast.success("Image ready", { description: "1 credit used · cached for this topic." });
          window.setTimeout(() => setImageStatus((s) => (s === "success" ? "idle" : s)), 1800);

          // Design canvas — inverted flow: once the image lands, auto-write
          // matching captions per selected platform so the user gets both.
          if (canvas?.type === "design-asset" && !variants.length) {
            void runCaptionsRef.current?.(platforms, overrideBrief || prompt);
          }

        }
      }, { signal: ctrl.signal, size: imageSize });
    } catch (e: any) {
      if (imageProgressTimerRef.current) window.clearInterval(imageProgressTimerRef.current);
      setImageLoading(false);
      if (e?.name === "AbortError") {
        setImageStatus("idle");
        setImageProgress(0);
        return;
      }
      const msg = e?.message ?? "Image generation failed";
      setImageError(msg);
      setImageStatus("error");
      toast.error("Image generation failed", { description: msg });
    }
  }, [imageLoading, variants, result, prompt, brand, workspaceName, imageSize, autoSize, activePlatform, canvas?.id, canvas?.type, platforms]);

  const cancelImageGeneration = useCallback(() => {
    imageAbortRef.current?.abort();
    if (imageProgressTimerRef.current) window.clearInterval(imageProgressTimerRef.current);
    setImageLoading(false);
    setImageStatus("idle");
    setImageProgress(0);
  }, []);

  // Generate captions for a specific subset of platforms. Used both by the
  // post-image auto-flow and by per-platform retry buttons in the stage strip.
  const runCaptions = useCallback(async (targets: PlatformId[], briefText: string) => {
    if (!targets.length) return;
    setCaptionStatus((prev) => {
      const next = { ...prev };
      for (const p of targets) next[p] = "loading";
      return next;
    });
    setCaptionErrors((prev) => {
      const next = { ...prev };
      for (const p of targets) delete next[p];
      return next;
    });
    try {
      const ctx = brandContextString(brand, workspaceName);
      const brief = briefText.trim();
      const captionPrompt = `You are writing social captions to accompany a visual that was just generated.\n\nVISUAL BRIEF:\n${brief}\n\nWrite a native caption per platform that reinforces the visual (do not describe it literally). Match brand voice.`;
      const res = await authedFetch("/api/social-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: captionPrompt, context: ctx, platforms: targets }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Caption generation failed (${res.status})`);
      const vs = (json?.variants ?? []) as SocialVariant[];
      const errs = (json?.errors ?? []) as Array<{ platform: PlatformId; error: string }>;
      const returned = new Set(vs.map((v) => v.platform));

      if (vs.length) {
        setVariants((prev) => {
          const map = new Map(prev.map((v) => [v.platform, v] as const));
          for (const v of vs) map.set(v.platform, v);
          // Preserve original selection order
          return platforms.map((p) => map.get(p)).filter(Boolean) as SocialVariant[];
        });
        setActivePlatform((cur) => (returned.has(cur) ? cur : vs[0].platform));
        setResult((cur) => cur || vs[0].body);
        void persistDraftsRef.current?.({
          canvasType: "design-asset",
          variants: vs,
          sourceTitle: brief.slice(0, 80),
        });
      }

      setCaptionStatus((prev) => {
        const next = { ...prev };
        for (const p of targets) next[p] = returned.has(p) ? "success" : "error";
        return next;
      });
      if (errs.length || targets.some((p) => !returned.has(p))) {
        setCaptionErrors((prev) => {
          const next = { ...prev };
          for (const p of targets) {
            if (!returned.has(p)) {
              const match = errs.find((e) => e.platform === p);
              next[p] = match?.error || "Model returned no variant";
            }
          }
          return next;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Caption generation failed";
      setCaptionStatus((prev) => {
        const next = { ...prev };
        for (const p of targets) next[p] = "error";
        return next;
      });
      setCaptionErrors((prev) => {
        const next = { ...prev };
        for (const p of targets) next[p] = msg;
        return next;
      });
    }
  }, [brand, workspaceName, platforms]);

  useEffect(() => { runCaptionsRef.current = runCaptions; }, [runCaptions]);

  // Reset caption stage whenever we jump to a new topic.
  useEffect(() => {
    setCaptionStatus({});
    setCaptionErrors({});
  }, [canvas?.id]);



  useEffect(() => {
    if (canvas) {
      setGenerated(canvas.mode !== "draft");
      setGenerating(false);
      setJustFinished(false);
      setProgress(0);
      draftIdsRef.current = canvas.id && UUID_RE.test(canvas.id) ? [canvas.id] : [];
      setResult("");
    } else {
      // Modal closed — clear the auto-run guard so reopening the same canvas
      // fires the initial generation again instead of being deduped.
      autoRunKeyRef.current = null;
    }
    // Only re-run when the canvas identity itself changes. brand/workspaceName
    // memoized refs can flip mid-session and would otherwise wipe an in-flight
    // draft the moment the user toggles a platform or edits the prompt.
  }, [canvas?.type, canvas?.id, canvas?.mode]);


  useEffect(() => {
    return () => { if (progressRef.current) window.clearInterval(progressRef.current); };
  }, []);

  const tile = canvas ? TILE_BY_ID[canvas.type] : null;
  const open = !!canvas;
  const color = canvas ? tintFor(canvas.type) : "#3b82f6";

  // NotebookLM-style: as soon as the model returns, persist drafts to
  // content_items so the in-flight "creating…" row in Needs Approval flips
  // into a real card the user can Approve / Publish / Skip — without
  // needing to close this modal.
  const persistDrafts = useCallback(async (args: {
    canvasType: CanvasType;
    text?: string;
    variants?: SocialVariant[];
    sourceTitle?: string;
  }) => {
    if (!workspaceId) return;
    try {
      // Re-generation: retire previous drafts from the inbox so we don't stack duplicates.
      if (draftIdsRef.current.length) {
        await Promise.allSettled(
          draftIdsRef.current.map((id) =>
            runUpdate({ data: { id, patch: { status: "rejected" } } }),
          ),
        );
        draftIdsRef.current = [];
      }

      const tileLocal = TILE_BY_ID[args.canvasType];
      const ids: string[] = [];

      if (args.variants?.length) {
        for (const v of args.variants) {
          const firstLine = v.body.split("\n").find((l) => l.trim()) || v.title;
          const channel = (v.platform === "twitter"
            ? "x"
            : v.platform === "threads"
              ? "x"
              : v.platform === "facebook"
                ? "facebook"
                : v.platform) as never;
          const row = await createItem({
            data: {
              workspaceId,
              agent: "echo",
              kind: "post",
              channel,
              title: (v.title || firstLine).replace(/^#+\s*/, "").slice(0, 120),
              body: v.body,
              hashtags: v.hashtags,
              status: "draft",
              meta: {
                canvas: args.canvasType,
                source: "studio",
                prompt,
                platform: v.platform,
                chars: v.chars,
              },
            },
          });
          ids.push(row.id);
        }
      } else if (args.text) {
        const firstLine =
          args.text.split("\n").find((l) => l.trim()) || tileLocal?.label || "Draft";
        const row = await createItem({
          data: {
            workspaceId,
            agent:
              args.canvasType === "seo-brief"
                ? "scout"
                : args.canvasType === "social-post"
                  ? "echo"
                  : "spark",
            kind: KIND_BY_CANVAS[args.canvasType],
            channel: CHANNEL_BY_CANVAS[args.canvasType] as never,
            title: (args.sourceTitle || firstLine).replace(/^#+\s*/, "").slice(0, 120),
            body: args.text,
            status: "draft",
            meta: { canvas: args.canvasType, source: "studio", prompt },
          },
        });
        ids.push(row.id);
      }

      draftIdsRef.current = ids;
      try { window.dispatchEvent(new CustomEvent("content:changed")); } catch {}
    } catch (e) {
      console.warn("[studio] persistDrafts failed", e);
    }
  }, [workspaceId, createItem, runUpdate, prompt]);

  useEffect(() => { persistDraftsRef.current = persistDrafts; }, [persistDrafts]);
  useEffect(() => { generatePostImageRef.current = generatePostImage; }, [generatePostImage]);



  const generateDraft = useCallback(async (activeCanvas: NonNullable<CanvasState>, requestPrompt: string, sourceTitle?: string) => {
    setGenerating(true);
    setProgress(0);
    setResult("");
    setVariants([]);
    setCaptionsConfirmed(false);
    setEditedPlatforms({});
    if (progressRef.current) window.clearInterval(progressRef.current);
    progressRef.current = window.setInterval(() => {
      setProgress((p) => Math.min(92, p + Math.random() * 6));
    }, 220);

    const tile = TILE_BY_ID[activeCanvas.type];
    const jobId = newJobId();
    const isSocialCanvas = activeCanvas.type === "social-post" || activeCanvas.type === "design-asset";
    genQueue.enqueue({
      id: jobId,
      label: sourceTitle || tile?.label || "New draft",
      canvas: activeCanvas.type,
      channel: isSocialCanvas ? platforms.join(",") : CHANNEL_BY_CANVAS[activeCanvas.type],
      phase: "brand-dna",
    });

    try {
      const ctx = brandContextString(brand, workspaceName);
      genQueue.advance(jobId, "research");

      if (isSocialCanvas) {
        if (!platforms.length) throw new Error("Pick at least one platform");
        const res = await authedFetch("/api/social-multi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: requestPrompt, context: ctx, platforms }),
        });
        genQueue.advance(jobId, "drafting");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || `Generation failed (${res.status})`);
        const vs = (json?.variants ?? []) as SocialVariant[];
        if (!vs.length) throw new Error("No variants returned");
        if (progressRef.current) window.clearInterval(progressRef.current);
        genQueue.advance(jobId, "polishing");
        setProgress(100);
        setVariants(vs);
        setActivePlatform(vs[0].platform);
        setResult(vs[0].body);
        setGenerating(false);
        setJustFinished(true);
        genQueue.advance(jobId, "ready");
        window.setTimeout(() => { setGenerated(true); setJustFinished(false); }, 480);
        genQueue.complete(jobId);
        void persistDrafts({ canvasType: activeCanvas.type, variants: vs, sourceTitle });
        return vs[0].body;
      }

      const res = await authedFetch("/api/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: TASK_BY_CANVAS[activeCanvas.type],
          prompt: `${requestPrompt}\n\nWrite the complete preview content now. Do not return an empty response. Use only the brand context and website data provided.`,
          context: ctx,
          url: brand?.websiteUrl || undefined,
        }),
      });
      genQueue.advance(jobId, "drafting");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Generation failed (${res.status})`);
      const text = String(json?.text || "").trim() || brandFallbackCopy(activeCanvas.type, brand, workspaceName, sourceTitle);
      if (progressRef.current) window.clearInterval(progressRef.current);
      genQueue.advance(jobId, "polishing");
      setProgress(100);
      setResult(text);
      setGenerating(false);
      setJustFinished(true);
      genQueue.advance(jobId, "ready");
      window.setTimeout(() => { setGenerated(true); setJustFinished(false); }, 480);
      genQueue.complete(jobId);
      void persistDrafts({ canvasType: activeCanvas.type, text, sourceTitle });
      return text;
    } catch (e: unknown) {
      if (progressRef.current) window.clearInterval(progressRef.current);
      const fallback = brandFallbackCopy(activeCanvas.type, brand, workspaceName, sourceTitle || requestPrompt);
      genQueue.advance(jobId, "polishing");
      setProgress(100);
      setResult(fallback);
      setGenerating(false);
      setGenerated(true);
      setJustFinished(false);
      genQueue.advance(jobId, "ready");
      genQueue.complete(jobId);
      void persistDrafts({ canvasType: activeCanvas.type, text: fallback, sourceTitle });
      toast.error("Generation failed", { description: e instanceof Error ? e.message : "Used fallback copy." });
      return fallback;
    }
  }, [brand, workspaceName, platforms, persistDrafts]);
  useEffect(() => { generateDraftRef.current = generateDraft; }, [generateDraft]);

  const onGenerate = async () => {
    if (!canvas) return;
    // Design canvas is INVERTED: image first, then captions written to match it.
    if (canvas.type === "design-asset") {
      setGenerated(true); // reveal preview shell so the image renders in-place
      await generatePostImage(prompt);
      return;
    }
    const text = await generateDraft(canvas, prompt);
    if (!text.trim()) toast.error("Couldn't generate", { description: "Please try again." });
  };


  useEffect(() => {
    if (!canvas) return;
    // Guard: this effect must only run ONCE per (canvas.id + type + mode).
    // Previously it also depended on `generateDraft`/`generatePostImage`
    // callbacks whose identity changed on every platform toggle, brand refresh,
    // or variant update — causing repeated auto-regenerations that wiped the
    // user's draft mid-edit ("weird behavior").
    const key = `${canvas.type}::${canvas.id ?? ""}::${canvas.mode ?? ""}`;
    if (autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;

    let cancelled = false;

    // Chat-first: if the assistant opened this canvas with a brief, use it
    // as the prompt AND auto-generate immediately so the user sees a real
    // draft instead of an empty seed screen.
    let chatBrief = "";
    try { chatBrief = sessionStorage.getItem(`studio:prefill:${canvas.type}`) || ""; } catch { /* noop */ }
    if (chatBrief) {
      try { sessionStorage.removeItem(`studio:prefill:${canvas.type}`); } catch { /* noop */ }
    }

    const nextPrompt = chatBrief || seedPrompt(canvas.type, brand, workspaceName);
    setPrompt(nextPrompt);
    setGenerated(false);
    setGenerating(false);
    setJustFinished(false);
    setProgress(0);
    setResult("");

    if (canvas.mode === "draft" && !canvas.id && !chatBrief) return;

    (async () => {
      let loadedText = "";
      let sourceTitle = "";

      if (canvas.id && UUID_RE.test(canvas.id)) {
        const { data: content } = await supabase
          .from("content_items")
          .select("title, body, hashtags")
          .eq("id", canvas.id)
          .maybeSingle();
        if (content) {
          sourceTitle = content.title || "";
          const tags = Array.isArray(content.hashtags) && content.hashtags.length
            ? `\n\n${content.hashtags.map((h) => (String(h).startsWith("#") ? h : `#${h}`)).join(" ")}`
            : "";
          loadedText = `${content.body || ""}${tags}`.trim();
        }

        if (!loadedText) {
          const { data: approval } = await supabase
            .from("approvals")
            .select("action, payload")
            .eq("id", canvas.id)
            .maybeSingle();
          if (approval) {
            sourceTitle = approval.action || sourceTitle;
            loadedText = textFromPayload((approval.payload ?? {}) as Record<string, unknown>);
          }
        }
      } else if (canvas.id) {
        sourceTitle = MOCK_APPROVALS.find((a) => a.id === canvas.id)?.title || "";
      }

      if (cancelled) return;
      if (loadedText.trim() && !chatBrief) {
        setResult(loadedText.trim());
        setGenerated(true);
        return;
      }

      // Design canvas — image-first: skip the text generation step, wait for the
      // user to click Generate (or use chat brief) so we don't burn image credits on open.
      if (canvas.type === "design-asset") {
        if (chatBrief) {
          setGenerated(true);
          await generatePostImageRef.current?.(chatBrief);
        }
        return;
      }

      await generateDraftRef.current?.(
        canvas,
        chatBrief
          ? chatBrief
          : `${nextPrompt}\n\n${sourceTitle ? `Approval item: ${sourceTitle}` : "Create the most useful ready-to-review preview for this client now."}`,
        sourceTitle,
      );
    })();

    return () => { cancelled = true; };
    // Intentionally excludes brand/workspaceName/callbacks — we auto-run
    // exactly once per canvas identity. See autoRunKeyRef guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas?.id, canvas?.mode, canvas?.type]);


  // Make sure drafts exist (in case generation was loaded from an existing item),
  // then return their ids for status transitions.
  const ensureDraftIds = useCallback(async (): Promise<string[]> => {
    if (draftIdsRef.current.length) return draftIdsRef.current;
    if (!canvas || !workspaceId) return [];
    if (isSocial && variants.length) {
      await persistDrafts({ canvasType: canvas.type, variants });
    } else {
      const text = result.trim() || brandFallbackCopy(canvas.type, brand, workspaceName, prompt);
      await persistDrafts({ canvasType: canvas.type, text });
    }
    return draftIdsRef.current;
  }, [canvas, workspaceId, isSocial, variants, result, brand, workspaceName, prompt, persistDrafts]);

  const onApprove = async () => {
    if (!canvas || !workspaceId) { onClose(); return; }
    setSaving(true);
    try {
      const scheduledAt = new Date();
      scheduledAt.setDate(scheduledAt.getDate() + 1);
      scheduledAt.setHours(9, 0, 0, 0);

      const ids = await ensureDraftIds();
      if (isSocial && ids.length) {
        // US3: real SDR schedule — each variant scheduled (staggered) to its
        // platform's selected accounts; the SDR beat fires at each time.
        const items = ids.map((id, i) => ({
          contentItemId: id,
          scheduledAt: new Date(scheduledAt.getTime() + i * 15 * 60 * 1000).toISOString(),
        }));
        const res = await scheduleContentItems(workspaceId, items, publishSelection);
        const scheduled = res.results.filter((r) => r.status === "publishing");
        const skipped = res.results.filter((r) => r.status === "skipped");
        draftIdsRef.current = [];
        toast.success(
          scheduled.length ? `Scheduled ${scheduled.length} post${scheduled.length === 1 ? "" : "s"}` : "Nothing scheduled",
          {
            description: skipped.length
              ? `${skipped.length} skipped (${skipped[0].reason ?? "no active target"})`
              : `Queued for ${scheduledAt.toLocaleString()}`,
          },
        );
      } else {
        // Non-social canvases keep the existing behavior.
        let offset = 0;
        for (const id of ids) {
          const when = new Date(scheduledAt.getTime() + offset * 15 * 60 * 1000);
          const variantBody = isSocial && variants[offset] ? variants[offset].body : null;
          await runUpdate({
            data: {
              id,
              patch: {
                status: "scheduled",
                scheduled_at: when.toISOString(),
                ...(variantBody ? { body: variantBody } : {}),
                ...(!isSocial && result.trim() ? { body: result.trim() } : {}),
              },
            },
          });
          offset++;
        }
        draftIdsRef.current = [];
        toast.success(
          ids.length > 1 ? `Scheduled ${ids.length} posts` : "Scheduled",
          { description: `Queued for ${scheduledAt.toLocaleString()}` },
        );
      }
      try { window.dispatchEvent(new CustomEvent("content:changed")); } catch {}
      onClose();
    } catch (e: unknown) {
      toast.error("Couldn't schedule", { description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const onPublishNow = async () => {
    if (!canvas || !workspaceId) { onClose(); return; }
    setPublishing(true);
    try {
      const ids = await ensureDraftIds();
      if (isSocial && ids.length) {
        // US2: real SDR publish — each variant goes to its platform's selected
        // accounts. Terminal confirmation arrives via webhook (US4).
        const res = await publishContentItems(workspaceId, ids, publishSelection);
        const publishing = res.results.filter((r) => r.status === "publishing");
        const skipped = res.results.filter((r) => r.status === "skipped");
        draftIdsRef.current = [];
        toast.success(
          publishing.length ? `Publishing ${publishing.length} post${publishing.length === 1 ? "" : "s"}…` : "Nothing to publish",
          {
            description: skipped.length
              ? `${skipped.length} skipped (${skipped[0].reason ?? "no active target"})`
              : "You'll see the live link as each platform confirms.",
          },
        );
        try { window.dispatchEvent(new CustomEvent("content:changed")); } catch {}
        onClose();
      } else {
        // Non-social canvases keep the existing behavior (no SDR involvement).
        const nowIso = new Date().toISOString();
        for (let i = 0; i < ids.length; i++) {
          const variantBody = isSocial && variants[i] ? variants[i].body : null;
          await runUpdate({
            data: {
              id: ids[i],
              patch: {
                status: "published",
                scheduled_at: nowIso,
                ...(variantBody ? { body: variantBody } : {}),
                ...(!isSocial && result.trim() ? { body: result.trim() } : {}),
              },
            },
          });
        }
        draftIdsRef.current = [];
        toast.success(ids.length > 1 ? `Published ${ids.length} posts` : "Published", {
          description: "Live now — visible in Recent and the client portal.",
        });
        try { window.dispatchEvent(new CustomEvent("content:changed")); } catch {}
        onClose();
      }
    } catch (e: unknown) {
      toast.error("Couldn't publish", { description: e instanceof Error ? e.message : "Please try again." });
    } finally {
      setPublishing(false);
    }
  };


  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AnimatePresence>
        {open && tile && canvas && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-xl"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 6 }}
                transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
                className="fixed left-1/2 top-1/2 z-50 flex h-[86vh] w-[94vw] max-w-[880px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-border/70 bg-background shadow-[0_30px_120px_-20px_rgba(0,0,0,0.55)]"
                style={{ boxShadow: `0 30px 120px -20px ${color}33, 0 0 0 1px ${color}1a inset` }}
              >
                {/* Top accent line — brand gradient */}
                <motion.div
                  aria-hidden
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, ease: EASE }}
                  className="absolute inset-x-0 top-0 h-[2px] origin-left"
                  style={{ background: `linear-gradient(90deg, hsl(var(--brand-blue)), ${color}, hsl(var(--brand-green)))` }}
                />
                {/* Generation progress bar */}
                <AnimatePresence>
                  {(generating || justFinished) && (
                    <motion.div
                      key="progress"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { delay: 0.3 } }}
                      className="absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden"
                    >
                      <motion.div
                        className="h-full"
                        style={{ background: `linear-gradient(90deg, hsl(var(--brand-blue)), ${color}, hsl(var(--brand-green)))`, boxShadow: `0 0 14px ${color}` }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.25, ease: EASE }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Ambient glow */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[120%] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
                  style={{ background: `radial-gradient(closest-side, ${color}, transparent 70%)` }}
                />

                <VisuallyHidden>
                  <DialogPrimitive.Title>{tile.label}</DialogPrimitive.Title>
                  <DialogPrimitive.Description>Studio canvas for {tile.label}.</DialogPrimitive.Description>
                </VisuallyHidden>

                {/* Header */}
                <header className="relative flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-full"
                      style={{ background: `linear-gradient(135deg, ${color}26, ${color}0a)`, boxShadow: `inset 0 0 0 1px ${color}33` }}
                    >
                      <tile.icon className="h-3.5 w-3.5" strokeWidth={2} style={{ color }} />
                    </span>
                    <h2 className="truncate text-[13px] font-semibold tracking-tight">{tile.label}</h2>
                    {workspaceName && <span className="hidden truncate text-[11.5px] text-muted-foreground sm:inline">· {workspaceName}</span>}
                  </div>
                  <DialogPrimitive.Close aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </DialogPrimitive.Close>
                </header>

                {/* Body */}
                <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <AnimatePresence mode="wait">
                    {generating ? (
                      <motion.div key="gen"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex h-full flex-col items-center justify-center gap-4 py-20 text-center"
                      >
                        <div className="relative grid h-20 w-20 place-items-center">
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-full"
                            style={{ border: `2px solid ${color}`, borderRightColor: "transparent", borderBottomColor: "transparent" }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                          />
                          <motion.span
                            aria-hidden
                            className="absolute inset-2 rounded-full opacity-40"
                            style={{ border: `2px solid ${color}`, borderLeftColor: "transparent", borderTopColor: "transparent" }}
                            animate={{ rotate: -360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          />
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-full"
                            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{ duration: 1.6, repeat: Infinity, ease: EASE }}
                            style={{ boxShadow: `0 0 40px ${color}` }}
                          />
                          <span className="tabular-nums text-[13px] font-semibold" style={{ color }}>
                            {Math.floor(progress)}%
                          </span>
                        </div>
                        <div className="text-[13px] font-medium">Drafting with your brand memory…</div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2].map((i) => (
                            <motion.span
                              key={i}
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: color }}
                              animate={{ opacity: [0.2, 1, 0.2], y: [0, -3, 0] }}
                              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    ) : justFinished ? (
                      <motion.div key="done"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center"
                      >
                        <motion.div
                          initial={{ scale: 0, rotate: -90 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ type: "spring", stiffness: 360, damping: 18 }}
                          className="grid h-14 w-14 place-items-center rounded-full text-white"
                          style={{ background: `linear-gradient(135deg, ${color}, hsl(var(--brand-green)))`, boxShadow: `0 12px 40px -8px ${color}` }}
                        >
                          <Check className="h-6 w-6" strokeWidth={3} />
                        </motion.div>
                        <motion.div
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
                          className="text-[13px] font-medium"
                        >
                          Draft ready
                        </motion.div>
                      </motion.div>
                    ) : generated ? (
                      <motion.div key="prev"
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="px-6 py-6"
                      >
                        {isSocial && variants.length > 0 ? (
                          <>
                            {canvas.type === "design-asset" && (
                              <StageProgress
                                color={color}
                                platforms={platforms}
                                imageStatus={imageStatus}
                                imageError={imageError}
                                imageProgress={imageProgress}
                                captionStatus={captionStatus}
                                captionErrors={captionErrors}
                                onRetryImage={() => generatePostImage(prompt)}
                                onRetryCaption={(p) => runCaptions([p], prompt)}
                                onRetryAllCaptions={() => {
                                  const failed = platforms.filter((p) => captionStatus[p] === "error");
                                  if (failed.length) void runCaptions(failed, prompt);
                                }}
                              />
                            )}
                            <SocialMultiPreview
                              variants={variants}
                              active={activePlatform}
                              onActive={(p) => { setActivePlatform(p); const v = variants.find(x => x.platform === p); if (v) setResult(v.body); }}
                              onChange={(p, body) => {
                                setVariants((prev) => prev.map(v => v.platform === p ? { ...v, body, chars: body.length } : v));
                                if (p === activePlatform) setResult(body);
                                setEditedPlatforms((prev) => ({ ...prev, [p]: true }));
                                setCaptionsConfirmed(false);
                              }}
                              brandName={brand?.brandName || workspaceName}
                              color={color}
                              image={postImage}
                              imageLoading={imageLoading}
                              imageStatus={imageStatus}
                              imageError={imageError}
                              imageProgress={imageProgress}
                              imageAttempt={imageAttempt}
                              onCancelImage={cancelImageGeneration}
                              imageSize={imageSize}
                              onSizeChange={(s) => { setAutoSize(false); setImageSize(s); }}
                              autoSize={autoSize}
                              onAutoSizeChange={(v) => {
                                setAutoSize(v);
                                if (v) setImageSize(sizeForPlatform(activePlatform));
                              }}
                              onGenerateImage={generatePostImage}
                              postBody={result}
                              postTitle={(canvas as any).title ?? null}
                              brand={brand}
                              workspaceName={workspaceName}
                              seedKey={canvas.id || "draft"}
                            />
                          </>



                        ) : (
                          <Preview
                            type={canvas.type}
                            text={result || brandFallbackCopy(canvas.type, brand, workspaceName, prompt)}
                            brandName={brand?.brandName || workspaceName}
                            color={color}
                            image={postImage}
                            imageLoading={imageLoading}
                            imageStatus={imageStatus}
                            imageError={imageError}
                            imageProgress={imageProgress}
                            imageAttempt={imageAttempt}
                            onCancelImage={cancelImageGeneration}
                            onGenerateImage={generatePostImage}
                          />
                        )}
                      </motion.div>

                    ) : (
                      <motion.div key="brief"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: EASE }}
                        className="mx-auto max-w-[640px] px-6 py-6"
                      >
                        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <Sparkles className="h-3 w-3" style={{ color }} />
                          Brand voice and audience are already wired in. Just describe what you want.
                        </p>
                        <div className="relative mt-3 group">
                          <div
                            aria-hidden
                            className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-focus-within:opacity-100"
                            style={{ background: `linear-gradient(135deg, ${color}55, transparent 60%)`, filter: "blur(8px)" }}
                          />
                          <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={6}
                            className="relative w-full resize-none rounded-2xl border border-border/60 bg-card p-3 text-[13px] leading-relaxed outline-none transition-colors"
                            style={{ caretColor: color }}
                            onFocus={(e) => (e.currentTarget.style.borderColor = `${color}80`)}
                            onBlur={(e) => (e.currentTarget.style.borderColor = "")}
                          />
                        </div>
                        {isSocial && (
                          <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between">
                              <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Publish to · {platforms.length} platform{platforms.length === 1 ? "" : "s"}
                              </div>
                              <div className="text-[11px] text-muted-foreground">One native variant per platform</div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {PLATFORM_ORDER.map((id) => {
                                const spec = PLATFORMS[id];
                                const selected = platforms.includes(id);
                                const Icon = spec.icon;
                                return (
                                  <button
                                    key={id}
                                    onClick={() => setPlatforms((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition",
                                      selected
                                        ? "border-transparent text-white shadow-sm"
                                        : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                                    )}
                                    style={selected ? { background: spec.color } : undefined}
                                  >
                                    <Icon className="h-3 w-3" />
                                    {spec.label}
                                    {selected && <Check className="h-3 w-3" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {["Shorter", "Punchier hook", "More data", "Add CTA"].map((chip) => (
                            <button
                              key={chip}
                              onClick={() => setPrompt((p) => `${p}\n— ${chip.toLowerCase()}`)}
                              className="rounded-full border border-border/60 bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                              style={{ borderColor: `${color}33` }}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {isSocial && generated && captionsConfirmed && variants.length > 0 && (
                  <div className="px-5 pb-1">
                    <StudioDestinationPicker workspaceId={workspaceId} value={publishSelection} onChange={setPublishSelection} />
                  </div>
                )}

                {/* US4 delivery view — per-platform status + live links for an
                    existing content item. Renders nothing until the item has
                    content_publications rows (webhook-driven); re-fetches on
                    content:changed so updates appear without a refresh (R2d). */}
                {isSocial && workspaceId && deliveryContentItemId ? (
                  <div className="px-5 pb-3">
                    <DeliveryView workspaceId={workspaceId} contentItemId={deliveryContentItemId} />
                  </div>
                ) : null}

                {/* Footer */}
                <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
                  {generated ? (
                    <>
                      <button onClick={() => setGenerated(false)} className="text-[12px] text-muted-foreground hover:text-foreground">
                        Edit brief
                      </button>
                      {isSocial && variants.length > 0 && !captionsConfirmed ? (
                        <>
                          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            {Object.values(editedPlatforms).filter(Boolean).length > 0
                              ? `Edited ${Object.values(editedPlatforms).filter(Boolean).length}/${variants.length} · review the rest`
                              : "Review captions across each platform before publishing"}
                          </span>
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setCaptionsConfirmed(true)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white shadow-lg"
                            style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 8px 24px -8px ${color}` }}
                          >
                            <Check className="h-3.5 w-3.5" /> Looks good — continue
                          </motion.button>
                        </>
                      ) : (
                        <>
                          <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-300">
                            <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.4, repeat: Infinity }} className="h-1 w-1 rounded-full bg-emerald-500" />
                            {isSocial ? "Captions confirmed" : "Saved to inbox"}
                          </span>
                          {isSocial && variants.length > 0 && (
                            <button
                              onClick={() => setCaptionsConfirmed(false)}
                              className="text-[12px] text-muted-foreground hover:text-foreground"
                            >
                              Edit captions
                            </button>
                          )}
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={onApprove}
                            disabled={saving || publishing}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 text-[12px] font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" /> {saving ? "Scheduling…" : "Schedule"}
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={onPublishNow}
                            disabled={saving || publishing}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white shadow-lg disabled:opacity-50"
                            style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 8px 24px -8px ${color}` }}
                          >
                            <Zap className="h-3.5 w-3.5" /> {publishing ? "Publishing…" : "Publish now"}
                          </motion.button>
                        </>
                      )}
                    </>
                  ) : (
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={onGenerate}
                      disabled={generating || !prompt.trim()}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white shadow-lg disabled:opacity-50"
                      style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 8px 24px -8px ${color}` }}
                    >
                      <Wand2 className="h-3.5 w-3.5" /> Generate
                    </motion.button>
                  )}
                </footer>

              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/* ----------------- Previews ----------------- */

function Preview({
  type, text, brandName, color,
  image, imageLoading, imageStatus, imageError, imageProgress, imageAttempt,
  onCancelImage, onGenerateImage,
}: {
  type: CanvasType; text: string; brandName?: string; color?: string;
  image?: string | null;
  imageLoading?: boolean;
  imageStatus?: "idle" | "loading" | "success" | "error";
  imageError?: string | null;
  imageProgress?: number;
  imageAttempt?: number;
  onCancelImage?: () => void;
  onGenerateImage?: () => void;
}) {
  const initial = (brandName || "B").trim().charAt(0).toUpperCase();
  const safeText = text.trim() || `${brandName || "This brand"} has a ready-to-review draft prepared from the active brand context.`;
  const c = color || "hsl(var(--brand-green))";
  const showImage = (type === "social-post" || type === "design-asset") && !!onGenerateImage;
  if (type === "social-post" || type === "design-asset") {
    return (
      <div className="mx-auto max-w-[440px] rounded-3xl border border-border/60 bg-card p-4">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/70">{initial}</div>
          <div>
            <div className="text-[12.5px] font-semibold">{brandName || "Brand"}</div>
            <div className="text-[10.5px] text-muted-foreground">LinkedIn</div>
          </div>
        </div>
        {showImage && (
          <div className={cn(
            "relative mt-3 w-full overflow-hidden rounded-2xl border border-border/60 bg-background/60 aspect-square",
            imageStatus === "error" && "border-destructive/50",
            imageStatus === "success" && "ring-1 ring-emerald-400/50",
          )}>
            {image ? (
              <>
                <img
                  src={image}
                  alt="Generated post visual"
                  className={cn(
                    "h-full w-full object-cover transition-[filter,transform] duration-500",
                    imageLoading ? "blur-lg scale-105" : "blur-0 scale-100"
                  )}
                />
                {imageStatus === "success" && !imageLoading && (
                  <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-sm">
                    <Check className="h-3 w-3" /> Ready
                  </div>
                )}
                <button
                  type="button"
                  onClick={imageLoading ? onCancelImage : onGenerateImage}
                  className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur transition hover:bg-background"
                >
                  {imageLoading ? (<><X className="h-3 w-3" /> Cancel</>) : (<><Wand2 className="h-3 w-3" /> Regenerate</>)}
                </button>
              </>
            ) : imageStatus === "loading" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center px-4">
                <div className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: `${c}1a` }}>
                  <div className="absolute inset-0 rounded-full border-2 border-transparent" style={{ borderTopColor: c, animation: "spin 0.9s linear infinite" }} />
                  <Sparkles className="h-4 w-4" style={{ color: c }} />
                </div>
                <span className="text-[12px] font-semibold text-foreground">
                  {(imageAttempt ?? 0) > 1 ? `Retrying (attempt ${imageAttempt})…` : "Generating your image…"}
                </span>
                <div className="h-1.5 w-[70%] max-w-[240px] overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${imageProgress ?? 0}%`, background: `linear-gradient(90deg, ${c}, ${c}aa)` }} />
                </div>
                <button type="button" onClick={onCancelImage} className="mt-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[10.5px] text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            ) : imageStatus === "error" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="h-4 w-4" /></div>
                <div className="text-[12px] font-semibold text-foreground">Image generation failed</div>
                <p className="max-w-[300px] text-[10.5px] leading-relaxed text-muted-foreground line-clamp-3">
                  {imageError || "Something went wrong. No credits were charged."}
                </p>
                <button type="button" onClick={onGenerateImage} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-md" style={{ background: `linear-gradient(135deg, ${c}, ${c}cc)` }}>
                  <Repeat className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center px-4">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-foreground/5">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <button
                  type="button"
                  onClick={onGenerateImage}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
                  style={{ background: `linear-gradient(135deg, ${c}, ${c}cc)` }}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Generate image
                </button>
                <p className="max-w-[280px] text-[10.5px] text-muted-foreground">
                  One on-brand visual — reused across every platform to save credits.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="prose prose-sm dark:prose-invert mt-3 max-w-none text-[13px] leading-relaxed text-foreground/90 [&>*]:my-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{safeText}</ReactMarkdown>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[680px] rounded-3xl border border-border/60 bg-card p-5">
      <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{safeText}</ReactMarkdown>
      </div>
    </div>
  );
}

/* ----------------- Multi-platform social preview ----------------- */

function SocialMultiPreview({
  variants, active, onActive, onChange, brandName, color,
  image, imageLoading, imageStatus, imageError, imageProgress, imageAttempt,
  onCancelImage, imageSize, onSizeChange, autoSize, onAutoSizeChange, onGenerateImage,
  postBody, postTitle, brand, workspaceName, seedKey,
}: {
  variants: SocialVariant[];
  active: PlatformId;
  onActive: (p: PlatformId) => void;
  onChange: (p: PlatformId, body: string) => void;
  brandName?: string;
  color: string;
  image: string | null;
  imageLoading: boolean;
  imageStatus: "idle" | "loading" | "success" | "error";
  imageError: string | null;
  imageProgress: number;
  imageAttempt: number;
  onCancelImage: () => void;
  imageSize: "1024x1024" | "1792x1024" | "1024x1792";
  onSizeChange: (s: "1024x1024" | "1792x1024" | "1024x1792") => void;
  autoSize: boolean;
  onAutoSizeChange: (v: boolean) => void;
  onGenerateImage: () => void;
  postBody: string;
  postTitle?: string | null;
  brand: BrandDnaLite | null;
  workspaceName?: string;
  seedKey: string;
}) {

  const current = variants.find((v) => v.platform === active) ?? variants[0];
  const spec = PLATFORMS[current.platform];
  const initial = (brandName || "B").trim().charAt(0).toUpperCase();
  const over = current.chars > spec.maxChars;
  const pct = Math.min(100, Math.round((current.chars / spec.maxChars) * 100));

  const aspectClass =
    imageSize === "1024x1024" ? "aspect-square"
    : imageSize === "1792x1024" ? "aspect-[16/9]"
    : "aspect-[9/16] max-h-[420px]";

  const SIZES: Array<{ id: typeof imageSize; label: string; sub: string }> = [
    { id: "1024x1024", label: "Square", sub: "1:1" },
    { id: "1792x1024", label: "Landscape", sub: "16:9" },
    { id: "1024x1792", label: "Portrait", sub: "9:16" },
  ];

  return (
    <div className="mx-auto max-w-[520px]">
      {/* Tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {variants.map((v) => {
          const s = PLATFORMS[v.platform];
          const Icon = s.icon;
          const isActive = v.platform === active;
          return (
            <button
              key={v.platform}
              onClick={() => onActive(v.platform)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition",
                isActive ? "border-transparent text-white shadow-sm" : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              )}
              style={isActive ? { background: s.color } : undefined}
            >
              <Icon className="h-3 w-3" />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Card preview */}
      <motion.div
        key={current.platform}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="rounded-3xl border border-border/60 bg-card overflow-hidden"
        style={{ boxShadow: `0 12px 40px -16px ${spec.color}55` }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5"
             style={{ background: `linear-gradient(90deg, ${spec.color}14, transparent)` }}>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/70">{initial}</div>
            <div>
              <div className="text-[12.5px] font-semibold">{brandName || "Brand"}</div>
              <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <spec.icon className="h-3 w-3" style={{ color: spec.color }} />
                {spec.label}
              </div>
            </div>
          </div>
          <span className={cn("text-[10.5px] tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
            {current.chars} / {spec.maxChars}
          </span>
        </div>

        {/* Shared image area — one image per topic, reused on every platform tab */}
        <div className="border-b border-border/60 bg-muted/30 p-3">
          <div className={cn(
            "relative w-full overflow-hidden rounded-2xl border border-border/60 bg-background/60",
            aspectClass,
            imageStatus === "error" && "border-destructive/50",
            imageStatus === "success" && "ring-1 ring-emerald-400/50",
          )}>
            {image ? (
              <>
                <img
                  src={image}
                  alt="Generated post visual"
                  className={cn(
                    "h-full w-full object-cover transition-[filter,transform] duration-500",
                    imageLoading ? "blur-lg scale-105" : "blur-0 scale-100"
                  )}
                />
                {imageStatus === "success" && !imageLoading && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
                  >
                    <Check className="h-3 w-3" /> Ready
                  </motion.div>
                )}
                <div className="absolute right-2 top-2 flex items-center gap-1">
                  <div className="rounded-full bg-background/85 shadow-sm backdrop-blur">
                    <PromptInspector
                      postBody={postBody}
                      postTitle={postTitle}
                      brand={brand}
                      workspaceName={workspaceName}
                      platform={active}
                      size={imageSize}
                      seedKey={seedKey}
                      autoSize={autoSize}
                      compact
                    />
                  </div>
                  <button
                    type="button"
                    onClick={imageLoading ? onCancelImage : onGenerateImage}
                    className="inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur transition hover:bg-background"
                  >
                    {imageLoading ? (<><X className="h-3 w-3" /> Cancel</>) : (<><Wand2 className="h-3 w-3" /> Regenerate</>)}
                  </button>
                </div>
              </>


            ) : imageStatus === "loading" ? (
              <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden text-center">
                {/* animated shimmer */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-70"
                  style={{
                    background: `linear-gradient(115deg, ${color}18 0%, transparent 30%, ${color}22 55%, transparent 80%)`,
                    backgroundSize: "220% 100%",
                    animation: "studio-shimmer 1.6s linear infinite",
                  }}
                />
                <div className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: `${color}1a` }}>
                  <div className="absolute inset-0 rounded-full border-2 border-transparent" style={{ borderTopColor: color, animation: "spin 0.9s linear infinite" }} />
                  <Sparkles className="h-4 w-4" style={{ color }} />
                </div>
                <div className="relative flex flex-col items-center gap-1">
                  <span className="text-[12px] font-semibold text-foreground">
                    {imageAttempt > 1 ? `Retrying (attempt ${imageAttempt})…` : "Generating your image…"}
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">On-brand · {imageSize.replace("x", " × ")} · usually 6–14s</span>
                </div>
                <div className="relative h-1.5 w-[70%] max-w-[260px] overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${imageProgress}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
                </div>
                <button
                  type="button"
                  onClick={onCancelImage}
                  className="relative mt-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[10.5px] text-muted-foreground transition hover:text-foreground"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            ) : imageStatus === "error" ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="text-[12px] font-semibold text-foreground">Image generation failed</div>
                <p className="max-w-[300px] text-[10.5px] leading-relaxed text-muted-foreground line-clamp-3">
                  {imageError || "Something went wrong. No credits were charged for the failed attempt."}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onGenerateImage}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-md"
                    style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
                  >
                    <Repeat className="h-3.5 w-3.5" /> Retry
                  </button>
                  <span className="text-[10px] text-muted-foreground">No credit charged</span>
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-foreground/5">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <button
                  type="button"
                  onClick={onGenerateImage}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold text-white shadow-md transition hover:brightness-110 active:scale-[0.98]"
                  style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Generate image
                </button>
                <p className="max-w-[280px] text-[10.5px] text-muted-foreground">
                  One on-brand visual for this topic — reused across every platform to save credits.
                </p>
              </div>
            )}
          </div>

          {/* Size selector + credit meter */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => onAutoSizeChange(!autoSize)}
                disabled={imageLoading}
                title={autoSize ? `Auto: matching ${PLATFORMS[active].label}` : "Auto-pick optimal size per platform"}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] transition disabled:opacity-50",
                  autoSize
                    ? "border-transparent text-white shadow-sm"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
                )}
                style={autoSize ? { background: color } : undefined}
              >
                <Sparkles className="h-2.5 w-2.5" />
                Auto
              </button>
              {SIZES.map((s) => {
                const sel = s.id === imageSize;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSizeChange(s.id)}
                    disabled={imageLoading}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10.5px] transition disabled:opacity-50",
                      sel && !autoSize
                        ? "border-transparent text-white"
                        : sel && autoSize
                          ? "border-dashed text-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
                    )}
                    style={sel && !autoSize ? { background: color } : sel && autoSize ? { borderColor: color, color } : undefined}
                  >
                    {s.label} · {s.sub}
                  </button>
                );
              })}
            </div>
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px]",
              imageStatus === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}>
              <Zap className="h-2.5 w-2.5" />
              {imageStatus === "success" ? "1 credit used" : imageStatus === "loading" ? "Reserving 1 credit…" : autoSize ? `Auto · optimal for ${PLATFORMS[active].label}` : "1 credit per generation"}
            </span>
          </div>
        </div>


        <textarea
          value={current.body}
          onChange={(e) => onChange(current.platform, e.target.value)}
          rows={Math.min(14, Math.max(6, Math.ceil(current.body.length / 70)))}
          className="w-full resize-none bg-transparent p-4 text-[13px] leading-relaxed outline-none"
          style={{ caretColor: spec.color }}
        />

        <div className="h-1 w-full bg-border/40">
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, background: over ? "hsl(var(--destructive))" : spec.color }}
          />
        </div>
      </motion.div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{spec.hashtags[0]}-{spec.hashtags[1]} hashtags · sweet spot ~{spec.optimalChars} chars</span>
        <span>{variants.length} platform{variants.length === 1 ? "" : "s"} ready</span>
      </div>
    </div>
  );
}

/* ----------------- Multi-stage progress strip ----------------- */

type StageState = "idle" | "loading" | "success" | "error";

function StageDot({ state, color }: { state: StageState; color: string }) {
  if (state === "success") {
    return (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="grid h-4 w-4 place-items-center rounded-full bg-destructive text-white">
        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "loading") {
    return (
      <span
        className="h-4 w-4 rounded-full border-2 border-transparent"
        style={{ borderTopColor: color, borderRightColor: `${color}55`, animation: "spin 0.9s linear infinite" }}
      />
    );
  }
  return <span className="h-4 w-4 rounded-full border border-border/60 bg-muted/40" />;
}

function StageProgress({
  color, platforms, imageStatus, imageError, imageProgress,
  captionStatus, captionErrors,
  onRetryImage, onRetryCaption, onRetryAllCaptions,
}: {
  color: string;
  platforms: PlatformId[];
  imageStatus: StageState;
  imageError: string | null;
  imageProgress: number;
  captionStatus: Partial<Record<PlatformId, StageState>>;
  captionErrors: Partial<Record<PlatformId, string>>;
  onRetryImage: () => void;
  onRetryCaption: (p: PlatformId) => void;
  onRetryAllCaptions: () => void;
}) {
  const captionStates = platforms.map((p) => captionStatus[p] ?? "idle");
  const anyCaptionActive = captionStates.some((s) => s !== "idle");
  const failedPlatforms = platforms.filter((p) => captionStatus[p] === "error");
  const loadingCount = captionStates.filter((s) => s === "loading").length;
  const successCount = captionStates.filter((s) => s === "success").length;

  // Hide the strip entirely if nothing interesting is happening.
  if (imageStatus === "idle" && !anyCaptionActive) return null;

  const imageLabel =
    imageStatus === "loading" ? `Generating image · ${imageProgress}%`
    : imageStatus === "success" ? "Image ready"
    : imageStatus === "error" ? "Image failed"
    : "Image";

  const captionLabel =
    loadingCount > 0 ? `Writing captions · ${successCount}/${platforms.length}`
    : failedPlatforms.length ? `${failedPlatforms.length} caption${failedPlatforms.length === 1 ? "" : "s"} failed`
    : successCount === platforms.length ? "All captions ready"
    : "Captions";

  return (
    <div className="mx-auto mb-4 max-w-[520px] rounded-2xl border border-border/60 bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Progress</span>
        {failedPlatforms.length > 1 && (
          <button
            type="button"
            onClick={onRetryAllCaptions}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10.5px] font-medium text-foreground/80 hover:bg-muted"
          >
            <Repeat className="h-2.5 w-2.5" /> Retry all
          </button>
        )}
      </div>

      {/* Stage 1: Image */}
      <div className="flex items-center gap-2 rounded-xl px-2 py-1.5">
        <StageDot state={imageStatus} color={color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">{imageLabel}</span>
            {imageStatus === "error" && (
              <button
                type="button"
                onClick={onRetryImage}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
              >
                <Repeat className="h-2.5 w-2.5" /> Retry
              </button>
            )}
          </div>
          {imageStatus === "error" && imageError && (
            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-tight text-destructive">{imageError}</p>
          )}
          {imageStatus === "loading" && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${imageProgress}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
            </div>
          )}
        </div>
      </div>

      {/* Connector */}
      <div className="ml-[9px] h-3 w-px bg-border/60" />

      {/* Stage 2: Captions */}
      <div className="flex items-start gap-2 rounded-xl px-2 py-1.5">
        <StageDot
          state={
            captionStates.every((s) => s === "success") ? "success"
            : captionStates.some((s) => s === "error") && !loadingCount ? "error"
            : loadingCount ? "loading"
            : "idle"
          }
          color={color}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-foreground">{captionLabel}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {platforms.map((p) => {
              const s = captionStatus[p] ?? "idle";
              const spec = PLATFORMS[p];
              const Icon = spec.icon;
              return (
                <div
                  key={p}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px]",
                    s === "success" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    s === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                    s === "loading" && "border-border/60 bg-muted/50 text-foreground/80",
                    s === "idle" && "border-border/50 bg-muted/30 text-muted-foreground",
                  )}
                  title={s === "error" ? captionErrors[p] : spec.label}
                >
                  <Icon className="h-2.5 w-2.5" style={s === "idle" ? undefined : { color: s === "error" ? undefined : spec.color }} />
                  <span className="max-w-[80px] truncate">{spec.label}</span>
                  {s === "success" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  {s === "loading" && (
                    <span
                      className="h-2 w-2 rounded-full border border-transparent"
                      style={{ borderTopColor: color, borderRightColor: `${color}55`, animation: "spin 0.9s linear infinite" }}
                    />
                  )}
                  {s === "error" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRetryCaption(p); }}
                      className="ml-0.5 inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-1 py-[1px] text-[9.5px] font-semibold hover:bg-destructive/25"
                    >
                      <Repeat className="h-2 w-2" /> Retry
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


