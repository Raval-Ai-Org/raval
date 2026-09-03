"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Check,
  Globe,
  Sparkles,
  Plus,
  X,
  Pencil,
  Image as ImageIcon,
  Palette,
  Megaphone,
  AlertTriangle,
  FileText,
  Info,
} from "@/components/brand/icons";
import {
  RefreshCw,
  Loader2,
  Type,
  Building2,
  Users,
  ShoppingBag,
  ShieldCheck,
  Download,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Link2,
} from "@/components/ui/gemini-icons";
import { ArrowLeft, Search as SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useBrandDna,
  emptyDna,
  type BrandDna,
  type BrandColor,
  type BrandSource,
} from "@/hooks/use-brand-dna";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { buildDesignMd, downloadDesignMd } from "@/lib/design-md";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BrandDnaEditor } from "./BrandDnaEditor";

const SEG =
  "group relative inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function normalizeUrl(raw: string | null | undefined) {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#0b0b0e" : "#ffffff";
}

const PLATFORM_KEYS: Record<string, BrandKey | undefined> = {
  linkedin: "linkedin",
  twitter: "x",
  x: "x",
  instagram: "instagram",
  youtube: "youtube",
  tiktok: "tiktok",
};

export function BrandDnaButton({ workspaceId }: { workspaceId: string | null }) {
  const { dna, save: rawSave, replace, filledCount, total } = useBrandDna(workspaceId);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const save = useCallback(
    (patch: Partial<BrandDna>) => {
      setDirty(true);
      rawSave(patch);
    },
    [rawSave],
  );
  const [websiteUrl, setWebsiteUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [activeTile, setActiveTile] = useState<TileKey | null>(null);
  const [progress, setProgress] = useState<{
    stage: string;
    message: string;
    pct: number;
    log: { stage: string; message: string; pct: number; at: number }[];
  }>({ stage: "idle", message: "", pct: 0, log: [] });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const overviewScrollRef = useRef(0);
  const lastTileRef = useRef<TileKey | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const [tileQuery, setTileQuery] = useState("");
  const [tileCategory, setTileCategory] = useState<TileCategory>("all");
  const openTile = useCallback((t: TileKey) => {
    overviewScrollRef.current = scrollRef.current?.scrollTop ?? 0;
    lastTileRef.current = t;
    scrollRef.current?.scrollTo({ top: 0 });
    setActiveTile(t);
  }, []);
  const closeTile = useCallback(() => {
    setActiveTile(null);
  }, []);
  const requestClose = useCallback(() => {
    if (dirty) {
      const ok = window.confirm("Discard unsaved Brand DNA edits and close?");
      if (!ok) return false;
    }
    setDirty(false);
    setActiveTile(null);
    setOpen(false);
    return true;
  }, [dirty]);

  // Restore overview scroll and focus the previously-opened tile
  useEffect(() => {
    if (activeTile !== null) {
      // scroll editor to top and focus back button for a11y
      scrollRef.current?.scrollTo({ top: 0 });
      const id = requestAnimationFrame(() => backButtonRef.current?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(id);
    }
    // Returning to overview: restore scroll & focus last tile
    const target = overviewScrollRef.current;
    const key = lastTileRef.current;
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: target });
      if (key) {
        const el = scrollRef.current?.querySelector<HTMLButtonElement>(
          `button[data-tile-key="${key}"]`,
        );
        el?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [activeTile]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    supabase
      .from("workspaces")
      .select("website_url")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWebsiteUrl(normalizeUrl(data?.website_url ?? null));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const h = (e: Event) => {
      setOpen(true);
      const tab = (e as CustomEvent).detail?.tab as string | undefined;
      // legacy map: essentials → voice tile, brand → overview
      if (tab === "essentials") setActiveTile("voice");
      else if (tab && TILE_KEYS.includes(tab as TileKey)) setActiveTile(tab as TileKey);
      else setActiveTile(null);
    };
    window.addEventListener("open:brand-dna", h);
    return () => window.removeEventListener("open:brand-dna", h);
  }, []);

  // Escape from an open tile returns to the overview (without closing the dialog).
  useEffect(() => {
    if (!open || !activeTile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setActiveTile(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, activeTile]);

  useEffect(() => {
    if (!websiteUrl) return;
    if (dna.websiteUrl !== websiteUrl) save({ websiteUrl });
    if (!urlInput) setUrlInput(websiteUrl.replace(/^https?:\/\//, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteUrl]);

  const runFetch = async (overrideUrl?: string, opts?: { silent?: boolean }) => {
    const raw = overrideUrl ?? websiteUrl ?? dna.websiteUrl ?? null;
    const url = normalizeUrl(raw);
    const silent = opts?.silent === true;
    if (!url) {
      if (!silent) toast.error("Add your website URL first");
      return;
    }
    setStatus("loading");
    setLastError(null);
    setProgress({
      stage: "start",
      message: "Starting…",
      pct: 2,
      log: [{ stage: "start", message: "Starting…", pct: 2, at: Date.now() }],
    });
    try {
      const res = await authedFetch("/api/brand-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let data: any = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let evt: any;
          try {
            evt = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (evt.type === "progress") {
            setProgress((prev) => ({
              stage: evt.stage,
              message: evt.message,
              pct: Math.max(prev.pct, evt.pct ?? prev.pct),
              log: [
                ...prev.log,
                {
                  stage: evt.stage,
                  message: evt.message,
                  pct: evt.pct ?? prev.pct,
                  at: Date.now(),
                },
              ].slice(-12),
            }));
          } else if (evt.type === "result") {
            data = evt.data;
          } else if (evt.type === "error") {
            streamError = evt.error || "Extraction failed";
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!data) throw new Error("No data returned");

      const existingCompByName = new Map(
        dna.competitors.map((c) => [c.name.toLowerCase().trim(), c]),
      );
      const mergedCompetitors = [
        ...dna.competitors,
        ...(
          (data.competitors ?? []) as Array<{
            name: string;
            url?: string;
            positioning?: string;
            strengths?: string;
            weaknesses?: string;
            notes?: string;
          }>
        )
          .filter((c) => c?.name && !existingCompByName.has(c.name.toLowerCase().trim()))
          .map((c) => ({
            id: crypto.randomUUID(),
            name: c.name,
            url: c.url,
            positioning: c.positioning,
            strengths: c.strengths,
            weaknesses: c.weaknesses,
            notes: c.notes,
          })),
      ].slice(0, 12);

      const cs = data.customerSignals ?? {};
      const mergedCustomer = {
        ...dna.customer,
        jobsToBeDone: dna.customer.jobsToBeDone || cs.jobsToBeDone || "",
        painPoints: dna.customer.painPoints || cs.painPoints || "",
        objections: dna.customer.objections || cs.objections || "",
        buyingTriggers: dna.customer.buyingTriggers || cs.buyingTriggers || "",
        decisionCriteria: dna.customer.decisionCriteria || cs.decisionCriteria || "",
        channels: dna.customer.channels || cs.channels || "",
        feedback: dna.customer.feedback || cs.feedback || "",
      };

      const existingTitles = new Set(dna.userInsights.map((i) => i.title.toLowerCase().trim()));
      const newInsights = ((data.insights ?? []) as Array<{ title: string; body: string }>)
        .filter((i) => i?.title && !existingTitles.has(i.title.toLowerCase().trim()))
        .map((i) => ({
          id: crypto.randomUUID(),
          title: i.title,
          body: i.body || "",
          createdAt: Date.now(),
          source: "user" as const,
        }));

      const kwSet = new Set([
        ...dna.keywords.map((k) => k.toLowerCase()),
        ...((data.keywords ?? []) as string[]).map((k) => k.toLowerCase()),
      ]);
      const mergedKeywords = Array.from(kwSet).filter(Boolean).slice(0, 20);

      const fill = (current: string, incoming: unknown) =>
        current && current.trim() ? current : (typeof incoming === "string" ? incoming : "") || "";

      const existingAssetUrls = new Set(dna.assets.map((a) => a.url));
      const extras = (data.extras ?? {}) as {
        emails?: string[];
        phones?: string[];
        headings?: string[];
        pagesCrawled?: string[];
        externalMentions?: { bucket: string; title: string; url: string; snippet: string }[];
      };
      const newAssets: typeof dna.assets = [];
      const pushAsset = (
        label: string,
        url: string | null | undefined,
        kind: "logo" | "image" | "link",
      ) => {
        if (!url || existingAssetUrls.has(url)) return;
        existingAssetUrls.add(url);
        newAssets.push({ id: crypto.randomUUID(), label, url, kind });
      };
      pushAsset("Logo", data.logoUrl, "logo");
      pushAsset("Favicon", data.faviconUrl, "image");
      for (const s of (data.socials ?? []) as Array<{ platform: string; url: string }>) {
        pushAsset(s.platform || "Social", s.url, "link");
      }

      const summaryBits: string[] = [];
      if (extras.pagesCrawled?.length)
        summaryBits.push(`Crawled ${extras.pagesCrawled.length} pages.`);
      if (extras.emails?.length)
        summaryBits.push(`Emails: ${extras.emails.slice(0, 3).join(", ")}.`);
      if (extras.phones?.length)
        summaryBits.push(`Phones: ${extras.phones.slice(0, 2).join(", ")}.`);
      if (extras.externalMentions?.length)
        summaryBits.push(`${extras.externalMentions.length} external mentions captured.`);
      const summaryNote = summaryBits.length
        ? [
            {
              id: crypto.randomUUID(),
              title: `Website extraction — ${new Date().toLocaleDateString()}`,
              body: summaryBits.join(" "),
              createdAt: Date.now(),
              source: "manual" as const,
            },
          ]
        : [];

      const existingFb = new Set(
        dna.customer.feedbackSources.map((s) => s.text.toLowerCase().trim()),
      );
      const newFeedbackSources = (extras.externalMentions ?? [])
        .filter((m) => m.bucket === "Reviews/Feedback" && m.snippet)
        .filter((m) => !existingFb.has(m.snippet.toLowerCase().trim()))
        .slice(0, 8)
        .map((m) => ({
          id: crypto.randomUUID(),
          text: m.snippet,
          sourceLabel: m.title || "Web mention",
          sourceUrl: m.url,
          capturedAt: Date.now(),
        }));

      replace({
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
        keywords: mergedKeywords,
        competitors: mergedCompetitors,
        customer: {
          ...mergedCustomer,
          feedbackSources: [...dna.customer.feedbackSources, ...newFeedbackSources],
        },
        assets: [...dna.assets, ...newAssets].slice(0, 60),
        notes: [...summaryNote, ...dna.notes].slice(0, 50),
        userInsights: [...newInsights, ...dna.userInsights].slice(0, 80),
        sources: { ...(dna.sources ?? {}), ...(data.sources ?? {}) },
        missing: Array.isArray(data.missing) ? data.missing : dna.missing,
        status: "ok",
        lastError: null,
        extractedAt: Date.now(),
      });

      setStatus("ok");
      toast.success("Brand DNA synced", {
        description: `${extras.pagesCrawled?.length ?? 1} pages • ${mergedCompetitors.length} competitors • ${newInsights.length} insights`,
      });
    } catch (e: any) {
      const msg = e?.message ?? "Try again later";
      setStatus("error");
      setLastError(msg);
      if (!silent) toast.error("Couldn't sync", { description: msg });
    }
  };

  useEffect(() => {
    const empty = !dna.brandName && !dna.logoUrl && dna.colors.length === 0;
    const url = websiteUrl ?? dna.websiteUrl;
    if (empty && url && status === "idle") runFetch(url, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteUrl, workspaceId]);

  const onDownloadDesignMd = () => {
    downloadDesignMd(buildDesignMd(dna));
    toast.success("Design.md downloaded");
  };

  const connectedUrl = websiteUrl ?? dna.websiteUrl ?? null;
  const submitUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    setWebsiteUrl(u);
    runFetch(u);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setOpen(true);
          return;
        }
        requestClose();
      }}
    >
      <DialogTrigger asChild>
        <button
          className={SEG}
          title="Brand DNA — everything Mellox AI knows about your brand"
          aria-label={`Open Brand DNA (${filledCount} of ${total} fields filled)`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="relative grid h-3.5 w-3.5 place-items-center" aria-hidden="true">
            <svg viewBox="0 0 14 14" className="absolute inset-0 -rotate-90">
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="hsl(var(--border))"
                strokeWidth="1.5"
                fill="none"
              />
              <motion.circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="hsl(var(--brand-green))"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                pathLength={1}
                initial={{ strokeDasharray: 1, strokeDashoffset: 1 }}
                animate={{ strokeDashoffset: 1 - (total ? filledCount / total : 0) }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </svg>
            <Brain className="h-2 w-2 text-[hsl(var(--brand-green))]" strokeWidth={2.4} />
          </span>
          <span className="hidden md:inline">Brand DNA</span>
          <span
            aria-hidden="true"
            className="rounded bg-secondary/80 px-1 text-[10px] tabular-nums text-muted-foreground group-hover:text-foreground"
          >
            {filledCount}/{total}
          </span>
        </button>
      </DialogTrigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-labelledby="brand-dna-title"
          aria-describedby="brand-dna-desc"
          className="fixed left-1/2 top-1/2 z-50 flex h-[92vh] w-[96vw] max-w-[1280px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-background p-0 shadow-[0_30px_120px_-20px_rgba(0,0,0,0.45),0_1px_0_0_hsl(var(--border)),inset_0_1px_0_hsl(0_0%_100%/0.06)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogHeader className="sr-only">
            <DialogTitle id="brand-dna-title">Brand DNA</DialogTitle>
            <DialogDescription id="brand-dna-desc">
              Everything Mellox AI knows about your brand. Use Tab to move between tiles, Enter or
              Space to open one, and Escape to return to the overview.
            </DialogDescription>
          </DialogHeader>

          {/* Brand halo — matches unified AppModalShell surface */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-0 opacity-70"
            style={{
              background:
                "radial-gradient(60% 50% at 18% 0%, hsl(var(--brand-blue) / 0.10), transparent 60%), radial-gradient(50% 45% at 100% 100%, hsl(var(--brand-green) / 0.12), transparent 65%)",
            }}
          />

          {/* Sticky top bar */}
          <div className="relative z-10 flex items-center gap-3 px-4 py-2.5 sm:px-6">
            {activeTile ? (
              <button
                ref={backButtonRef}
                onClick={closeTile}
                aria-label="Back to Brand DNA overview"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-[12px] font-medium text-foreground/80 transition-all hover:-translate-x-0.5 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <span
                  className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(var(--brand-green))] to-[hsl(220_90%_60%)] shadow-[0_6px_18px_-6px_hsl(var(--brand-green)/0.55)]"
                  aria-hidden="true"
                >
                  <Brain className="h-3.5 w-3.5 text-white" />
                  <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_60%_at_50%_0%,rgba(255,255,255,0.35),transparent_60%)]" />
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-[13.5px] font-semibold tracking-tight text-foreground">
                    Brand DNA
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    What Ravi knows about you
                  </span>
                </div>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {dirty && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-500 sm:px-2.5"
                  title="You have edits that haven't been confirmed yet"
                  aria-label="Unsaved changes"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
                  />
                  <span className="hidden sm:inline">Unsaved</span>
                </span>
              )}
              <StatusPill status={status} extractedAt={dna.extractedAt} progress={progress} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => runFetch()}
                disabled={status === "loading" || !connectedUrl}
                className="h-8 rounded-full px-3 text-[12px] focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))]"
                title="Re-sync from your website"
                aria-label={
                  status === "loading"
                    ? "Re-syncing from your website"
                    : "Re-sync from your website"
                }
              >
                {status === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Re-sync</span>
              </Button>
              <DialogPrimitive.Close
                aria-label="Close Brand DNA"
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            {status === "loading" && (
              <div
                className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
                role="progressbar"
                aria-label="Syncing Brand DNA"
                aria-valuenow={progress.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <motion.div
                  className="h-full w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--brand-green))] to-transparent"
                  initial={{ x: "-100%" }}
                  animate={{ x: "300%" }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                />
              </div>
            )}
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] motion-safe:scroll-smooth"
          >
            <AnimatePresence mode="wait" initial={false}>
              {activeTile === null ? (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="px-4 py-4 sm:px-6 sm:py-5"
                >
                  <OverviewHero
                    dna={dna}
                    connectedUrl={connectedUrl}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    onSubmit={submitUrl}
                    status={status}
                  />
                  <TileToolbar
                    query={tileQuery}
                    setQuery={setTileQuery}
                    category={tileCategory}
                    setCategory={setTileCategory}
                  />
                  <TileGrid dna={dna} onOpen={openTile} query={tileQuery} category={tileCategory} />
                  {status === "error" && lastError && (
                    <div className="mt-5 flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[12.5px] text-rose-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium text-rose-300">Couldn't read your site</div>
                        <div className="opacity-80">{lastError}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => runFetch()}
                        className="h-7 rounded-full px-2.5 text-rose-300 hover:text-rose-200"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </Button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key={`edit-${activeTile}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="grid gap-5 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_300px]"
                >
                  <div className="min-w-0">
                    <TileEditor tile={activeTile} dna={dna} save={save} />
                  </div>
                  <aside aria-label="Live brand summary preview" className="hidden lg:block">
                    <div className="sticky top-2">
                      <LiveSummaryPane dna={dna} activeTile={activeTile} dirty={dirty} />
                    </div>
                  </aside>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3 sm:px-7">
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!workspaceId) return;
                  const t = toast.loading("Reading chat for insights…");
                  try {
                    const { syncMemoryFromChat } = await import("@/lib/memory-sync");
                    const res = await syncMemoryFromChat(workspaceId, dna, save);
                    toast.dismiss(t);
                    if (res.added > 0)
                      toast.success(
                        `Saved ${res.added} new memory item${res.added > 1 ? "s" : ""}`,
                      );
                    else
                      toast.info(
                        res.skipped ? `Nothing new (${res.skipped})` : "No new insights yet",
                      );
                  } catch {
                    toast.dismiss(t);
                    toast.error("Memory sync failed");
                  }
                }}
                disabled={!workspaceId}
                className="h-8 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <Brain className="h-3.5 w-3.5" />{" "}
                <span className="hidden sm:inline">Sync from chat</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onDownloadDesignMd}
                className="h-8 rounded-full px-2.5 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />{" "}
                <span className="hidden sm:inline">Export</span>
              </Button>
            </div>
            <Button
              size="sm"
              onClick={() => {
                toast.success(dirty ? "Changes saved" : "All up to date");
                setDirty(false);
                setOpen(false);
                setActiveTile(null);
              }}
              className="group h-9 rounded-full px-5 text-[13px] font-medium text-white shadow-[0_8px_22px_-8px_hsl(var(--brand-green)/0.65)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundImage:
                  "linear-gradient(120deg, hsl(var(--brand-blue)) 0%, hsl(var(--brand-green)) 100%)",
              }}
            >
              <Check className="h-3.5 w-3.5" /> {dirty ? "Save & close" : "Done"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

/* ─────────── STATUS PILL ─────────── */

function StatusPill({
  status,
  extractedAt,
  progress,
}: {
  status: "idle" | "loading" | "ok" | "error";
  extractedAt: number | null;
  progress: { message: string; pct: number };
}) {
  const meta = useMemo(() => {
    if (status === "loading") {
      const pct = Math.max(2, Math.min(99, progress.pct || 0));
      return {
        icon: Loader2,
        spin: true,
        label: `${progress.message || "Reading site…"} · ${pct}%`,
        tone: "text-muted-foreground",
      };
    }
    if (status === "error")
      return { icon: XCircle, spin: false, label: "Sync failed", tone: "text-rose-400" };
    if (status === "ok" || extractedAt)
      return {
        icon: CheckCircle2,
        spin: false,
        label: extractedAt ? `Synced ${timeAgo(extractedAt)}` : "Synced",
        tone: "text-[hsl(var(--brand-green))]",
      };
    return { icon: Link2, spin: false, label: "Not synced", tone: "text-muted-foreground" };
  }, [status, extractedAt, progress]);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 text-[11.5px]",
        meta.tone,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", meta.spin && "animate-spin")} />
      <span className="max-w-[220px] truncate">{meta.label}</span>
    </span>
  );
}

function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

/* ─────────── OVERVIEW HERO (brand card + URL input) ─────────── */

function OverviewHero({
  dna,
  connectedUrl,
  urlInput,
  setUrlInput,
  onSubmit,
  status,
}: {
  dna: BrandDna;
  connectedUrl: string | null;
  urlInput: string;
  setUrlInput: (s: string) => void;
  onSubmit: () => void;
  status: "idle" | "loading" | "ok" | "error";
}) {
  const displayUrl = connectedUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const chips = [
    dna.industry && { label: dna.industry, icon: Building2 },
    dna.audienceTags?.[0] && { label: dna.audienceTags[0], icon: Users },
    dna.valueTags?.[0] && { label: dna.valueTags[0], icon: ShieldCheck },
    dna.colors?.[0] && {
      label: `${dna.colors.length} color${dna.colors.length > 1 ? "s" : ""}`,
      icon: Palette,
    },
  ].filter(Boolean) as { label: string; icon: any }[];

  return (
    <div className="mb-6 sm:mb-7">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span className="h-1 w-1 rounded-full bg-[hsl(var(--brand-green))]" />
        Living brand memory
      </div>
      <h2 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]">
        {dna.brandName || "Your Brand DNA"}
      </h2>
      <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
        {dna.oneLiner ||
          "Click any tile to customize your brand identity. Ravi uses this to write, design and post on your behalf."}
      </p>

      {(connectedUrl || chips.length > 0) && (
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {connectedUrl && (
            <a
              href={connectedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-card hover:text-foreground"
            >
              <Globe className="h-3 w-3" /> {displayUrl}
            </a>
          )}
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11.5px] text-muted-foreground"
            >
              <c.icon className="h-3 w-3" />{" "}
              <span className="max-w-[180px] truncate">{c.label}</span>
            </span>
          ))}
        </div>
      )}

      {!connectedUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card/40 p-3">
          <Globe className="ml-1 h-4 w-4 text-muted-foreground" />
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSubmit())}
            placeholder="yourbrand.com — we'll auto-fill everything below"
            className="h-9 flex-1 min-w-[200px] border-0 bg-transparent text-[13.5px] focus-visible:ring-0"
          />
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={status === "loading" || !urlInput.trim()}
            className="h-9 rounded-full px-4 text-[13px]"
          >
            {status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Auto-fill
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─────────── TILE GRID (Pomelli-inspired) ─────────── */

type TileKey =
  | "logo"
  | "identity"
  | "typography"
  | "colors"
  | "voice"
  | "headline"
  | "audience"
  | "competitors"
  | "customers"
  | "assets"
  | "notes";
const TILE_KEYS: TileKey[] = [
  "logo",
  "identity",
  "typography",
  "colors",
  "voice",
  "headline",
  "audience",
  "competitors",
  "customers",
  "assets",
  "notes",
];

type TileCategory = "all" | "identity" | "visual" | "voice" | "market" | "knowledge";

type TileMeta = {
  key: TileKey;
  label: string;
  category: Exclude<TileCategory, "all">;
  keywords: string;
};

const TILE_META: TileMeta[] = [
  { key: "logo", label: "Logo", category: "visual", keywords: "logo mark brand image icon" },
  {
    key: "identity",
    label: "Brand",
    category: "identity",
    keywords: "brand name industry description mission",
  },
  {
    key: "colors",
    label: "Colors",
    category: "visual",
    keywords: "colors palette hex swatch primary accent",
  },
  {
    key: "typography",
    label: "Typography",
    category: "visual",
    keywords: "font typography family heading body typeface",
  },
  {
    key: "voice",
    label: "Voice & tone",
    category: "voice",
    keywords: "voice tone style guidelines writing",
  },
  {
    key: "headline",
    label: "Headline",
    category: "voice",
    keywords: "headline tagline slogan promise",
  },
  {
    key: "audience",
    label: "Audience",
    category: "market",
    keywords: "audience target market segment icp",
  },
  {
    key: "competitors",
    label: "Competitors",
    category: "market",
    keywords: "competitors rivals alternatives comparison",
  },
  {
    key: "customers",
    label: "Customers",
    category: "market",
    keywords: "customers personas testimonials quotes reviews",
  },
  {
    key: "assets",
    label: "Assets",
    category: "knowledge",
    keywords: "assets files uploads images pdf",
  },
  {
    key: "notes",
    label: "Notes",
    category: "knowledge",
    keywords: "notes insights memory rules facts",
  },
];

const CATEGORY_LABEL: Record<TileCategory, string> = {
  all: "All",
  identity: "Identity",
  visual: "Visual",
  voice: "Voice",
  market: "Market",
  knowledge: "Knowledge",
};

function TileToolbar({
  query,
  setQuery,
  category,
  setCategory,
}: {
  query: string;
  setQuery: (v: string) => void;
  category: TileCategory;
  setCategory: (c: TileCategory) => void;
}) {
  const categories: TileCategory[] = ["all", "identity", "visual", "voice", "market", "knowledge"];
  return (
    <div className="mb-4 flex flex-col gap-2.5 sm:mb-5 sm:flex-row sm:items-center sm:gap-3">
      <label className="relative flex min-w-0 flex-1 items-center">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground"
        />
        <span className="sr-only">Search Brand DNA sections</span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand rules… (logo, colors, voice)"
          aria-label="Search Brand DNA sections"
          className="h-9 rounded-full border-border/60 bg-card/50 pl-9 pr-9 text-[13px] placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))]"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </label>
      <div
        role="group"
        aria-label="Filter Brand DNA by category"
        className="-mx-1 flex snap-x snap-mandatory items-center gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((c) => {
          const active = category === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              aria-label={`Filter: ${CATEGORY_LABEL[c]}`}
              onClick={() => setCategory(c)}
              className={cn(
                "shrink-0 snap-start rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-[hsl(var(--brand-green))]/60 bg-[hsl(var(--brand-green))]/15 text-foreground"
                  : "border-border/60 bg-card/40 text-foreground/75 hover:bg-card/70 hover:text-foreground",
              )}
            >
              {CATEGORY_LABEL[c]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TileGrid({
  dna,
  onOpen,
  query,
  category,
}: {
  dna: BrandDna;
  onOpen: (t: TileKey) => void;
  query: string;
  category: TileCategory;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-tile]") ?? [],
    );
    if (buttons.length === 0) return;
    const activeIdx = buttons.findIndex((b) => b === document.activeElement);
    let next = activeIdx;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown")
      next = activeIdx < 0 ? 0 : (activeIdx + 1) % buttons.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = activeIdx < 0 ? 0 : (activeIdx - 1 + buttons.length) % buttons.length;
    if (next !== activeIdx || activeIdx < 0) {
      e.preventDefault();
      buttons[next]?.focus();
    }
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    return new Set(
      TILE_META.filter(
        (t) =>
          (category === "all" || t.category === category) &&
          (q === "" || t.label.toLowerCase().includes(q) || t.keywords.includes(q)),
      ).map((t) => t.key),
    );
  }, [q, category]);

  if (visible.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-10 text-center">
        <SearchIcon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <p className="text-[13px] text-foreground/80">No sections match "{query}"</p>
        <p className="text-[12px] text-muted-foreground">
          Try a different keyword or clear the category filter.
        </p>
      </div>
    );
  }

  const show = (k: TileKey) => visible.has(k);

  return (
    <div
      ref={gridRef}
      role="group"
      aria-label="Brand DNA sections"
      onKeyDown={onKeyDown}
      className="grid auto-rows-[minmax(140px,auto)] grid-cols-1 gap-3 sm:auto-rows-[minmax(170px,auto)] sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3"
    >
      {show("logo") && (
        <Tile
          tileKey="logo"
          label="Logo"
          ariaLabel="Edit Logo"
          span="sm:row-span-2"
          onClick={() => onOpen("logo")}
        >
          <LogoTilePreviewLarge dna={dna} />
        </Tile>
      )}
      {show("identity") && (
        <Tile
          tileKey="identity"
          label="Brand"
          ariaLabel="Edit Brand identity"
          onClick={() => onOpen("identity")}
        >
          <IdentityPreview dna={dna} />
        </Tile>
      )}
      {show("colors") && (
        <Tile
          tileKey="colors"
          label="Colors"
          ariaLabel={`Edit Colors (${dna.colors.length} defined)`}
          span="sm:row-span-2"
          onClick={() => onOpen("colors")}
        >
          <ColorsPreview dna={dna} />
        </Tile>
      )}
      {show("typography") && (
        <Tile
          tileKey="typography"
          label="Typography"
          ariaLabel="Edit Typography"
          onClick={() => onOpen("typography")}
        >
          <TypographyPreview dna={dna} />
        </Tile>
      )}
      {show("voice") && (
        <Tile
          tileKey="voice"
          label="Voice & tone"
          ariaLabel="Edit Voice and tone"
          onClick={() => onOpen("voice")}
        >
          <VoicePreview dna={dna} />
        </Tile>
      )}
      {show("headline") && (
        <Tile
          tileKey="headline"
          label="Headline"
          ariaLabel="Edit Headline"
          onClick={() => onOpen("headline")}
        >
          <HeadlinePreview dna={dna} />
        </Tile>
      )}
      {show("audience") && (
        <Tile
          tileKey="audience"
          label="Audience"
          ariaLabel="Edit Audience"
          onClick={() => onOpen("audience")}
        >
          <AudiencePreview dna={dna} />
        </Tile>
      )}
      {show("competitors") && (
        <Tile
          tileKey="competitors"
          label="Competitors"
          ariaLabel={`Edit Competitors (${dna.competitors.length} tracked)`}
          onClick={() => onOpen("competitors")}
        >
          <CountPreview
            count={dna.competitors.length}
            icon={Building2}
            label="tracked"
            empty="Track who you're up against"
          />
        </Tile>
      )}
      {show("customers") && (
        <Tile
          tileKey="customers"
          label="Customers"
          ariaLabel={`Edit Customers (${dna.customer.personas.length + dna.customer.testimonials.length} entries)`}
          onClick={() => onOpen("customers")}
        >
          <CountPreview
            count={dna.customer.personas.length + dna.customer.testimonials.length}
            icon={Users}
            label="personas + quotes"
            empty="Add personas & signals"
          />
        </Tile>
      )}
      {show("assets") && (
        <Tile
          tileKey="assets"
          label="Assets"
          ariaLabel={`Edit Assets (${dna.assets.length} uploaded)`}
          onClick={() => onOpen("assets")}
        >
          <AssetsPreview dna={dna} />
        </Tile>
      )}
      {show("notes") && (
        <Tile
          tileKey="notes"
          label="Notes"
          ariaLabel={`Edit Notes (${dna.notes.length + dna.userInsights.length} items)`}
          onClick={() => onOpen("notes")}
        >
          <CountPreview
            count={dna.notes.length + dna.userInsights.length}
            icon={FileText}
            label="notes & insights"
            empty="Capture what agents should remember"
          />
        </Tile>
      )}
    </div>
  );
}

function Tile({
  label,
  ariaLabel,
  children,
  onClick,
  span,
  tileKey,
}: {
  label: string;
  ariaLabel?: string;
  children: React.ReactNode;
  onClick: () => void;
  span?: string;
  tileKey?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      data-tile
      data-tile-key={tileKey}
      aria-label={ariaLabel ?? `Edit ${label}`}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/50 text-left transition-all duration-200",
        "hover:border-[hsl(var(--brand-green))]/40 hover:bg-card hover:shadow-[0_18px_40px_-24px_hsl(var(--brand-green)/0.45)]",
        "focus:outline-none focus-visible:outline-none focus-visible:border-[hsl(var(--brand-green))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:rounded-3xl",
        span,
      )}
    >
      {/* Hover glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120% 60% at 50% 0%, hsl(var(--brand-green)/0.10), transparent 70%)",
        }}
      />
      {/* Shine sweep */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-y-1 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent opacity-0 transition-all duration-700 group-hover:left-[150%] group-hover:opacity-100"
      />

      <div
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-5"
        aria-hidden="true"
      >
        {children}
      </div>
      <div className="relative flex items-center justify-between gap-2 border-t border-border/40 bg-background/50 px-4 py-2 text-[11.5px] font-medium text-muted-foreground sm:px-5 sm:py-2.5 sm:text-[12px]">
        <span className="min-w-0 truncate text-foreground/85">{label}</span>
        <span className="inline-flex items-center gap-1 opacity-70 transition-all sm:opacity-0 sm:-translate-x-1 sm:group-hover:opacity-100 sm:group-hover:translate-x-0 sm:group-focus-visible:opacity-100 sm:group-focus-visible:translate-x-0">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Edit</span>
          <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </span>
      </div>
    </motion.button>
  );
}

/* Tile previews — visual, on-brand */

function LogoTilePreviewLarge({ dna }: { dna: BrandDna }) {
  const primary = dna.colors[0]?.hex;
  const [errored, setErrored] = useState(false);
  const src = errored ? dna.faviconUrl : dna.logoUrl || dna.faviconUrl;
  const initials = (dna.brandName || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div
      className="grid h-full min-h-[220px] place-items-center rounded-2xl"
      style={{ background: primary ? `${primary}18` : "hsl(var(--secondary))" }}
    >
      {src ? (
        <img
          src={src}
          alt={dna.brandName}
          onError={() => setErrored(true)}
          className="max-h-[70%] max-w-[70%] object-contain"
        />
      ) : (
        <span className="text-[54px] font-semibold tracking-tight text-foreground/70">
          {initials || "?"}
        </span>
      )}
    </div>
  );
}

function IdentityPreview({ dna }: { dna: BrandDna }) {
  const font = dna.fonts[0];
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div
        className="truncate text-[26px] font-semibold leading-tight tracking-tight text-foreground"
        style={font ? { fontFamily: `'${font}', ui-sans-serif, system-ui` } : undefined}
      >
        {dna.brandName || <span className="text-muted-foreground">Add brand name</span>}
      </div>
      {dna.websiteUrl ? (
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Link2 className="h-3.5 w-3.5" />
          <span className="truncate">
            {dna.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </span>
        </div>
      ) : (
        <div className="text-[12.5px] text-muted-foreground">No website connected</div>
      )}
      {dna.industry && (
        <span className="mt-1 inline-flex w-fit items-center rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] text-foreground/70">
          {dna.industry}
        </span>
      )}
    </div>
  );
}

function TypographyPreview({ dna }: { dna: BrandDna }) {
  const [display, body] = [dna.fonts[0], dna.fonts[1]];
  return (
    <div className="flex h-full items-center gap-4">
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[42px] leading-none text-foreground"
          style={display ? { fontFamily: `'${display}', ui-sans-serif, system-ui` } : undefined}
        >
          Aa
        </div>
        <div className="mt-1 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
          {display || "Display font"}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[42px] leading-none text-foreground/70"
          style={body ? { fontFamily: `'${body}', ui-sans-serif, system-ui` } : undefined}
        >
          Aa
        </div>
        <div className="mt-1 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
          {body || "Body font"}
        </div>
      </div>
    </div>
  );
}

function ColorsPreview({ dna }: { dna: BrandDna }) {
  const cols = dna.colors.slice(0, 4);
  if (cols.length === 0) {
    return (
      <div className="grid h-full place-items-center text-[12.5px] text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Palette className="h-6 w-6 opacity-50" />
          <span>Add brand colors</span>
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-[220px] grid-cols-2 gap-2.5">
      {cols.map((c, i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded-2xl ring-1 ring-border/30"
          style={{ background: c.hex }}
        >
          <span
            className="absolute bottom-2 left-2.5 font-mono text-[10.5px] uppercase"
            style={{ color: readableOn(c.hex) }}
          >
            {c.hex}
          </span>
        </div>
      ))}
    </div>
  );
}

function VoicePreview({ dna }: { dna: BrandDna }) {
  const text = dna.voice || dna.values;
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Megaphone className="h-3.5 w-3.5" /> How you sound
      </div>
      <p className="line-clamp-3 text-[14px] leading-relaxed text-foreground/85">
        {text || <span className="text-muted-foreground">Add voice, tone and core values.</span>}
      </p>
    </div>
  );
}

function HeadlinePreview({ dna }: { dna: BrandDna }) {
  const line = dna.oneLiner || dna.about || dna.positioning;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Tagline
      </div>
      <p className="line-clamp-3 text-[15px] font-medium leading-snug text-foreground">
        {line || (
          <span className="font-normal text-muted-foreground">
            Add a one-liner about your brand.
          </span>
        )}
      </p>
    </div>
  );
}

function AudiencePreview({ dna }: { dna: BrandDna }) {
  const tags = dna.audienceTags.slice(0, 6);
  if (tags.length === 0 && !dna.audience) {
    return (
      <div className="grid h-full place-items-center text-[12.5px] text-muted-foreground">
        Who are you for?
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> Audience
      </div>
      {dna.audience && (
        <p className="line-clamp-2 text-[13px] text-foreground/85">{dna.audience}</p>
      )}
      {tags.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] text-foreground/80"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetsPreview({ dna }: { dna: BrandDna }) {
  const imgs = dna.assets.filter((a) => a.kind === "logo" || a.kind === "image").slice(0, 3);
  return (
    <div className="flex h-full items-center gap-2">
      {imgs.length === 0 ? (
        <div className="grid h-full w-full place-items-center text-[12.5px] text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <ImageIcon className="h-6 w-6 opacity-50" />
            <span>Add reusable assets</span>
          </div>
        </div>
      ) : (
        <>
          {imgs.map((a) => (
            <div
              key={a.id}
              className="h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-border/60 bg-secondary/40"
            >
              <img
                src={a.url}
                alt={a.label}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          ))}
          {dna.assets.length > imgs.length && (
            <span className="ml-1 rounded-full bg-secondary/80 px-2 py-1 text-[11.5px] tabular-nums text-muted-foreground">
              +{dna.assets.length - imgs.length}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function CountPreview({
  count,
  icon: Icon,
  label,
  empty,
}: {
  count: number;
  icon: any;
  label: string;
  empty: string;
}) {
  if (count === 0) {
    return (
      <div className="grid h-full place-items-center text-[12.5px] text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Icon className="h-6 w-6 opacity-50" />
          <span>{empty}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="text-[44px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
        {count}
      </div>
      <div className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
    </div>
  );
}

/* ─────────── LIVE SUMMARY PANE (real-time preview while editing) ─────────── */

function LiveSummaryPane({
  dna,
  activeTile,
  dirty,
}: {
  dna: BrandDna;
  activeTile: TileKey;
  dirty: boolean;
}) {
  const primary = dna.colors?.[0]?.hex || "#22c55e";
  const accent = dna.colors?.[1]?.hex || primary;
  const headingFont = dna.fonts?.[0] || "Inter";
  const bodyFont = dna.fonts?.[1] || dna.fonts?.[0] || "Inter";
  const name = dna.brandName?.trim() || "Your brand";
  const oneLiner = dna.oneLiner?.trim() || "Add a one-line description to see it here.";
  const audienceTags = (dna.audienceTags || []).filter(Boolean).slice(0, 4);
  const valueTags = (dna.valueTags || []).filter(Boolean).slice(0, 4);
  const voice = (dna.voice || "").trim();
  const dos = (dna.doRules || "")
    .split(/\n|,|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const donts = (dna.dontRules || "")
    .split(/\n|,|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const filled = [
    name !== "Your brand",
    dna.oneLiner,
    dna.voice,
    audienceTags.length,
    valueTags.length,
    dna.colors?.length,
    dna.logoUrl,
  ].filter(Boolean).length;
  const total = 7;

  return (
    <motion.div
      key={`summary-${activeTile}-${dirty ? "d" : "c"}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Live preview
        </div>
        {dirty && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" /> updating
          </span>
        )}
      </div>

      {/* Brand card */}
      <div
        className="mt-3 overflow-hidden rounded-xl border border-border/60"
        style={{ background: `linear-gradient(135deg, ${primary}14, ${accent}0a)` }}
      >
        <div className="flex items-center gap-3 p-3">
          {dna.logoUrl ? (
            <img
              src={dna.logoUrl}
              alt=""
              className="h-10 w-10 rounded-lg object-contain bg-background/80 p-1"
            />
          ) : (
            <div
              className="grid h-10 w-10 place-items-center rounded-lg text-sm font-semibold text-white"
              style={{ background: primary }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-[14px] font-semibold text-foreground"
              style={{ fontFamily: headingFont }}
            >
              {name}
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              {dna.industry || "Industry —"}
            </div>
          </div>
        </div>
        <div className="border-t border-border/50 bg-background/40 p-3">
          <p
            className="line-clamp-3 text-[12.5px] leading-relaxed text-foreground/85"
            style={{ fontFamily: bodyFont }}
          >
            {oneLiner}
          </p>
        </div>
      </div>

      {/* Palette */}
      {(dna.colors?.length || 0) > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Palette
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dna.colors!.slice(0, 6).map((c, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2 py-1"
              >
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-border/60"
                  style={{ background: c.hex }}
                />
                <span className="text-[10.5px] font-medium tabular-nums text-foreground/80">
                  {c.hex}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice */}
      {voice && (
        <div className="mt-3">
          <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Voice
          </div>
          <p className="line-clamp-2 text-[12px] italic text-foreground/80">"{voice}"</p>
        </div>
      )}

      {/* Audience */}
      {audienceTags.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Audience
          </div>
          <div className="flex flex-wrap gap-1">
            {audienceTags.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] text-foreground/80"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Values */}
      {valueTags.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Values
          </div>
          <div className="flex flex-wrap gap-1">
            {valueTags.map((t, i) => (
              <span
                key={i}
                className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                style={{ background: `${primary}18`, color: primary }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Do / Don't */}
      {(dos.length > 0 || donts.length > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
              Do
            </div>
            <ul className="space-y-0.5 text-[11px] text-foreground/85">
              {dos.length ? (
                dos.map((d, i) => (
                  <li key={i} className="line-clamp-1">
                    · {d}
                  </li>
                ))
              ) : (
                <li className="opacity-60">—</li>
              )}
            </ul>
          </div>
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-rose-500">
              Don't
            </div>
            <ul className="space-y-0.5 text-[11px] text-foreground/85">
              {donts.length ? (
                donts.map((d, i) => (
                  <li key={i} className="line-clamp-1">
                    · {d}
                  </li>
                ))
              ) : (
                <li className="opacity-60">—</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Completion */}
      <div className="mt-4 border-t border-border/50 pt-3">
        <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
          <span>Completeness</span>
          <span className="tabular-nums">
            {filled}/{total}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted/60">
          <motion.div
            className="h-full rounded-full"
            style={{ background: primary }}
            initial={false}
            animate={{ width: `${(filled / total) * 100}%` }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────── TILE EDITOR (right-panel content per tile) ─────────── */

function TileEditor({
  tile,
  dna,
  save,
}: {
  tile: TileKey;
  dna: BrandDna;
  save: (n: Partial<BrandDna>) => void;
}) {
  const meta: Record<TileKey, { title: string; subtitle: string }> = {
    logo: {
      title: "Logo",
      subtitle: "Your primary mark across light, brand and dark backgrounds.",
    },
    identity: { title: "Brand identity", subtitle: "Name, industry, business model and about." },
    typography: {
      title: "Typography",
      subtitle: "Display and body fonts Ravi uses in every post.",
    },
    colors: { title: "Colors", subtitle: "The palette that anchors every design." },
    voice: { title: "Voice & essentials", subtitle: "The 5 inputs Ravi uses to write like you." },
    headline: { title: "Tagline & positioning", subtitle: "The story behind what you sell." },
    audience: { title: "Audience", subtitle: "Who you're for — segments and tags." },
    competitors: {
      title: "Competitors",
      subtitle: "Players in your space — strengths, gaps, positioning.",
    },
    customers: { title: "Customers", subtitle: "Personas, testimonials and buying signals." },
    assets: { title: "Assets", subtitle: "Reusable images, logos and links." },
    notes: { title: "Notes", subtitle: "Durable memory captured from chat." },
  };
  const m = meta[tile];
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
          {m.title}
        </h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{m.subtitle}</p>
      </div>

      {tile === "logo" && <LogoTilesCard dna={dna} save={save} source={dna.sources?.logo} />}
      {tile === "identity" && <InfoGrid dna={dna} save={save} />}
      {tile === "typography" && <FontCard dna={dna} save={save} source={dna.sources?.fonts} />}
      {tile === "colors" && <PaletteCard dna={dna} save={save} source={dna.sources?.colors} />}
      {tile === "voice" && <BrandDnaEditor dna={dna} save={save} workspaceName={dna.brandName} />}
      {tile === "headline" && <PositioningGrid dna={dna} save={save} />}
      {tile === "audience" && (
        <div className="space-y-4">
          <TagsCard
            title="Target audience"
            icon={Users}
            tags={dna.audienceTags}
            onChange={(audienceTags) => save({ audienceTags })}
            placeholder="e.g. Founders, Growth leads"
            source={dna.sources?.audience}
          />
          <TagsCard
            title="Core values"
            icon={ShieldCheck}
            tags={dna.valueTags}
            onChange={(valueTags) => save({ valueTags })}
            placeholder="e.g. Autonomy, Speed, Craft"
          />
          <TagsCard
            title="SEO keywords"
            icon={Sparkles}
            tags={dna.keywords}
            onChange={(keywords) => save({ keywords })}
            placeholder="e.g. ai marketing"
          />
          <ChannelChips dna={dna} source={dna.sources?.socials} />
          <RulesGrid dna={dna} save={save} />
        </div>
      )}
      {tile === "competitors" && <CompetitorsTab dna={dna} save={save} />}
      {tile === "customers" && <CustomersTab dna={dna} save={save} />}
      {tile === "assets" && <AssetsTab dna={dna} save={save} />}
      {tile === "notes" && <NotesTab dna={dna} save={save} />}
    </div>
  );
}

/* ─────────── HERO ─────────── */

function BrandHero({
  dna,
  loading,
  websiteUrl,
  filled,
  total,
}: {
  dna: BrandDna;
  loading: boolean;
  websiteUrl: string | null;
  filled: number;
  total: number;
}) {
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return (
    <div className="relative overflow-hidden border-b border-border/60 px-4 pt-4 pb-4 pr-12 sm:px-6 sm:pt-5 sm:pb-5 sm:pr-14">
      {/* Soft Gemini-style aurora */}
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-90">
        <motion.div
          aria-hidden
          className="absolute -top-28 -left-20 h-64 w-64 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, hsl(var(--brand-green) / 0.22), transparent 70%)",
          }}
          animate={{ x: [0, 22, -10, 0], y: [0, 12, -6, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -top-20 right-1/3 h-56 w-56 rounded-full blur-3xl"
          style={{
            background: "radial-gradient(closest-side, hsl(220 90% 65% / 0.18), transparent 70%)",
          }}
          animate={{ x: [0, -14, 10, 0], y: [0, 8, -4, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-28 -right-10 h-64 w-64 rounded-full blur-3xl"
          style={{
            background: "radial-gradient(closest-side, hsl(280 80% 65% / 0.16), transparent 70%)",
          }}
          animate={{ x: [0, -18, 6, 0], y: [0, -10, 6, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:gap-4"
      >
        <div className="relative shrink-0">
          {/* Gemini-style multicolor halo */}
          <motion.div
            aria-hidden
            className="absolute -inset-1.5 -z-10 rounded-[22px] opacity-70 blur-md"
            style={{
              background:
                "conic-gradient(from 140deg, hsl(var(--brand-green)), hsl(220 90% 60%), hsl(280 80% 65%), hsl(var(--brand-green)))",
            }}
            animate={{ rotate: loading ? 360 : 0, opacity: loading ? [0.55, 0.95, 0.55] : 0.55 }}
            transition={{
              rotate: { duration: 8, repeat: loading ? Infinity : 0, ease: "linear" },
              opacity: { duration: 2.2, repeat: loading ? Infinity : 0, ease: "easeInOut" },
            }}
          />
          <LogoTile
            url={dna.logoUrl}
            fallback={dna.faviconUrl}
            bg={dna.colors[0]?.hex}
            name={dna.brandName}
            loading={loading}
            size={48}
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            <Brain className="h-3 w-3 shrink-0 text-[hsl(var(--brand-green))]" />
            <span className="truncate">Memory</span>
            <span className="ml-1 shrink-0 rounded-full bg-secondary/70 px-1.5 py-px text-[10px] font-medium tabular-nums tracking-normal text-muted-foreground">
              {pct}%
            </span>
          </div>
          <h2 className="mt-1 truncate text-[17px] font-semibold tracking-tight text-foreground sm:text-[20px]">
            {dna.brandName || (loading ? "Reading your site…" : "Your brand")}
          </h2>
          {websiteUrl ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
            </a>
          ) : (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              Connect your site to auto-fill everything below
            </p>
          )}
        </div>
      </motion.div>

      {loading && (
        <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <motion.div
            className="h-full w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--brand-green))] to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "300%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}
    </div>
  );
}

/* ─────────── NAV (sidebar on desktop, chips on mobile) ─────────── */

const NAV_META: {
  key: MemoryTabKey;
  label: string;
  icon: any;
  desc: string;
  headline: string;
  subhead: string;
}[] = [
  {
    key: "brand",
    label: "Brand",
    icon: Brain,
    desc: "Identity, palette, fonts",
    headline: "Brand identity",
    subhead: "How your brand looks, sounds, and shows up.",
  },
  {
    key: "essentials",
    label: "Essentials",
    icon: ShieldCheck,
    desc: "5-item checklist + preview",
    headline: "Brand DNA essentials",
    subhead: "The 5 inputs Ravi uses to write and design every post — with a live style preview.",
  },
  {
    key: "competitors",
    label: "Competitors",
    icon: Building2,
    desc: "Who you're up against",
    headline: "Competitors",
    subhead: "Players in your space — strengths, gaps, positioning.",
  },
  {
    key: "customers",
    label: "Customers",
    icon: Users,
    desc: "Audience & signals",
    headline: "Customers",
    subhead: "Personas, pains, triggers, and what they say about you.",
  },
  {
    key: "assets",
    label: "Assets",
    icon: ImageIcon,
    desc: "Logos & saved files",
    headline: "Assets",
    subhead: "Reusable images and files Mellox AI can reach for.",
  },
  {
    key: "notes",
    label: "Notes",
    icon: FileText,
    desc: "Insights & memory",
    headline: "Notes",
    subhead: "Durable notes and insights captured from your chats.",
  },
];

function MemoryNav({
  active,
  onChange,
  counts,
}: {
  active: MemoryTabKey;
  onChange: (k: MemoryTabKey) => void;
  counts: Record<MemoryTabKey, number>;
}) {
  return (
    <>
      {/* Desktop: sidebar */}
      <nav className="hidden md:flex w-[220px] shrink-0 flex-col gap-1 border-r border-border/60 bg-[hsl(var(--card))]/40 px-3 py-5">
        {NAV_META.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={cn(
                "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
                isActive
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="memory-nav-rail"
                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
                  style={{
                    background:
                      "linear-gradient(180deg, hsl(var(--brand-green)), hsl(220 90% 60%))",
                  }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 transition-colors",
                  isActive
                    ? "bg-background ring-border"
                    : "bg-card/40 ring-border/60 group-hover:bg-background/80",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{t.label}</span>
                  {counts[t.key] > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        isActive
                          ? "bg-background text-foreground"
                          : "bg-secondary/80 text-muted-foreground",
                      )}
                    >
                      {counts[t.key]}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.desc}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* Mobile: horizontal chips */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 bg-[hsl(var(--card))] px-4 py-2 md:hidden">
        {NAV_META.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={cn(
                "relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="memory-tab-pill"
                  className="absolute inset-0 -z-0 rounded-full bg-secondary"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {counts[t.key] > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] tabular-nums",
                      isActive
                        ? "bg-background/80 text-foreground"
                        : "bg-secondary/80 text-muted-foreground",
                    )}
                  >
                    {counts[t.key]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function TabHeadline({ tab }: { tab: MemoryTabKey }) {
  const meta = NAV_META.find((m) => m.key === tab)!;
  return (
    <div className="space-y-1.5 border-b border-border/40 pb-4">
      <h3 className="text-[20px] font-semibold leading-tight tracking-tight text-foreground">
        {meta.headline}
      </h3>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{meta.subhead}</p>
    </div>
  );
}

function LogoTile({
  url,
  fallback,
  bg,
  name,
  loading,
  size = 80,
}: {
  url: string | null;
  fallback: string | null;
  bg?: string;
  name: string;
  loading: boolean;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const src = !errored ? url || fallback : fallback;
  const initials = (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl ring-1 ring-border/70 shadow-sm"
      style={{ height: size, width: size, background: bg ? `${bg}22` : "hsl(var(--secondary))" }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          onError={() => setErrored(true)}
          className="h-[78%] w-[78%] object-contain"
          draggable={false}
        />
      ) : loading ? (
        <Loader2
          className="h-5 w-5 animate-spin text-muted-foreground"
          role="status"
          aria-label={`Loading ${name} logo`}
        />
      ) : (
        <span
          className="font-semibold tracking-tight text-foreground/80"
          style={{ fontSize: size * 0.28 }}
        >
          {initials || "?"}
        </span>
      )}
    </div>
  );
}

function PillTag({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card/70 px-2.5 py-1 text-[11px] text-foreground/80 ring-1 ring-border/60">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {children}
    </span>
  );
}

/* ─────────── URL CONNECT STEP ─────────── */

type ProgressState = {
  stage: string;
  message: string;
  pct: number;
  log: { stage: string; message: string; pct: number; at: number }[];
};

function UrlConnectStep({
  urlInput,
  setUrlInput,
  connectedUrl,
  status,
  lastError,
  extractedAt,
  progress,
  onConnect,
  onRetry,
}: {
  urlInput: string;
  setUrlInput: (s: string) => void;
  connectedUrl: string | null;
  status: "idle" | "loading" | "ok" | "error";
  lastError: string | null;
  extractedAt: number | null;
  progress: ProgressState;
  onConnect: (u: string) => void;
  onRetry: () => void;
}) {
  const submit = () => {
    const u = urlInput.trim();
    if (!u) return;
    onConnect(u);
  };

  const statusBadge = useMemo(() => {
    if (status === "loading") {
      const label = progress.message || "Reading your site…";
      const pct = Math.max(2, Math.min(99, progress.pct || 0));
      return {
        icon: Loader2,
        color: "text-muted-foreground",
        spin: true,
        label: `${label} · ${pct}%`,
      };
    }
    if (status === "error")
      return {
        icon: XCircle,
        color: "text-rose-500",
        spin: false,
        label: lastError || "Couldn't reach site",
      };
    if (status === "ok" || extractedAt)
      return {
        icon: CheckCircle2,
        color: "text-[hsl(var(--brand-green))]",
        spin: false,
        label: extractedAt ? `Synced ${new Date(extractedAt).toLocaleTimeString()}` : "Synced",
      };
    return { icon: Link2, color: "text-muted-foreground", spin: false, label: "Not connected" };
  }, [status, lastError, extractedAt, progress.message, progress.pct]);

  const SIcon = statusBadge.icon;

  const [editing, setEditing] = useState(false);
  const showInput = editing || !connectedUrl;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-medium text-foreground">Website</h3>
        <motion.span
          key={statusBadge.label}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 text-[11.5px]",
            statusBadge.color,
          )}
        >
          {status === "ok" || extractedAt ? (
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--brand-green))] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--brand-green))]" />
            </span>
          ) : (
            <SIcon className={cn("h-3.5 w-3.5 shrink-0", statusBadge.spin && "animate-spin")} />
          )}
          <span className="truncate">{statusBadge.label}</span>
        </motion.span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {showInput ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2"
          >
            <div className="relative flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-full border border-border/70 bg-card/70 px-4 py-2 focus-within:border-foreground/40 transition-colors">
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                autoFocus={editing}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.preventDefault(), submit(), setEditing(false))
                }
                placeholder="yourbrand.com"
                className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-[14px] focus-visible:ring-0"
              />
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/5 to-transparent"
                animate={{ x: ["-120%", "320%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button
                size="sm"
                onClick={() => {
                  submit();
                  setEditing(false);
                }}
                disabled={status === "loading" || !urlInput.trim()}
                className="h-10 shrink-0 rounded-full px-4 text-[13px] font-medium sm:px-5"
              >
                {status === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{connectedUrl ? "Switch" : "Connect"}</span>
              </Button>
            </motion.div>
            {connectedUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                className="h-10 shrink-0 rounded-full px-3 text-[12.5px] text-muted-foreground"
              >
                Cancel
              </Button>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="connected"
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2"
          >
            <motion.div
              layout
              className="group relative flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-full border border-border/70 bg-card/70 px-4 py-2 transition-colors hover:border-[hsl(var(--brand-green))]/40"
            >
              <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
                <Globe className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-[hsl(var(--brand-green))]" />
              </span>
              <a
                href={connectedUrl!}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-[14px] text-foreground transition-colors hover:text-[hsl(var(--brand-green))]"
              >
                {connectedUrl!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--brand-green))]/10 to-transparent opacity-0 group-hover:opacity-100"
                animate={{ x: ["-20%", "420%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              />
            </motion.div>
            <motion.div
              whileHover={{ scale: 1.04, rotate: status === "loading" ? 0 : -6 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                disabled={status === "loading"}
                className="h-10 shrink-0 rounded-full px-4 text-[13px] font-medium"
              >
                {status === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Re-sync</span>
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                className="h-10 shrink-0 rounded-full px-3 text-[12.5px] text-muted-foreground"
              >
                Change
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {status === "loading" && (
        <div className="space-y-2 px-1">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-secondary/60">
            <motion.div
              key="bar"
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[hsl(var(--brand-green))] to-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, Math.min(99, progress.pct))}%` }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
              animate={{ x: ["-100%", "300%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            />
          </div>
          {progress.log.length > 0 && (
            <p className="text-[11.5px] text-muted-foreground truncate">
              {progress.log[progress.log.length - 1]?.message}
            </p>
          )}
        </div>
      )}

      {status === "error" && lastError && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-[12px] text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-rose-300">Couldn't read your site</div>
            <div className="opacity-80">{lastError}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            className="h-7 rounded-full px-2.5 text-rose-300 hover:text-rose-200"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      )}
    </section>
  );
}

/* ─────────── SOURCE BADGE ─────────── */

function SourceBadge({ source }: { source?: BrandSource }) {
  if (!source) return null;
  const tip = source.snippet ? `${source.label} — "${source.snippet}"` : source.label;
  const content = (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
      <Info className="h-2.5 w-2.5" />
      <span className="max-w-[180px] truncate">{source.label}</span>
    </span>
  );
  return source.url ? (
    <a href={source.url} target="_blank" rel="noreferrer" title={tip} className="no-underline">
      {content}
    </a>
  ) : (
    <span title={tip}>{content}</span>
  );
}

/* ─────────── LOGO TILES (big visual) ─────────── */

function LogoTilesCard({
  dna,
  save,
  source,
}: {
  dna: BrandDna;
  save: (n: Partial<BrandDna>) => void;
  source?: BrandSource;
}) {
  const primary = dna.colors[0]?.hex;
  return (
    <SectionCard
      icon={ImageIcon}
      title="Logo"
      hint={dna.logoUrl ? "From your site" : "Not detected"}
      source={source}
    >
      <div className="grid grid-cols-3 gap-3">
        <LogoTilePreview
          label="Color"
          bg="hsl(var(--card))"
          logo={dna.logoUrl}
          fallback={dna.faviconUrl}
          name={dna.brandName}
        />
        <LogoTilePreview
          label="On primary"
          bg={primary || "hsl(var(--secondary))"}
          logo={dna.logoUrl}
          fallback={dna.faviconUrl}
          name={dna.brandName}
          dark={!!primary && readableOn(primary) === "#ffffff"}
        />
        <LogoTilePreview
          label="On dark"
          bg="#0b0b0e"
          logo={dna.logoUrl}
          fallback={dna.faviconUrl}
          name={dna.brandName}
          dark
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          defaultValue={dna.logoUrl ?? ""}
          onBlur={(e) => save({ logoUrl: e.target.value.trim() || null })}
          placeholder="Paste a logo URL to override…"
          className="h-8 text-[12px]"
        />
      </div>
    </SectionCard>
  );
}

function LogoTilePreview({
  label,
  bg,
  logo,
  fallback,
  name,
  dark,
}: {
  label: string;
  bg: string;
  logo: string | null;
  fallback: string | null;
  name: string;
  dark?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const src = !errored ? logo || fallback : fallback;
  const initials = (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-border/60">
      <div
        className="relative grid h-[88px] place-items-center sm:h-[110px] md:h-[120px]"
        style={{ background: bg }}
      >
        {src ? (
          <img
            src={src}
            alt={name}
            onError={() => setErrored(true)}
            className="h-12 w-12 object-contain sm:h-16 sm:w-16"
          />
        ) : (
          <span
            className={cn(
              "text-xl font-semibold tracking-tight sm:text-2xl",
              dark ? "text-white/80" : "text-foreground/80",
            )}
          >
            {initials || "?"}
          </span>
        )}
      </div>
      <div className="bg-[hsl(var(--card))] px-2 py-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground sm:text-[10.5px]">
        {label}
      </div>
    </div>
  );
}

/* ─────────── PALETTE ─────────── */

function PaletteCard({
  dna,
  save,
  source,
}: {
  dna: BrandDna;
  save: (n: Partial<BrandDna>) => void;
  source?: BrandSource;
}) {
  const updateColor = (i: number, patch: Partial<BrandColor>) => {
    const next = dna.colors.slice();
    next[i] = { ...next[i], ...patch };
    save({ colors: next });
  };
  const removeColor = (i: number) => save({ colors: dna.colors.filter((_, idx) => idx !== i) });
  const addColor = () => save({ colors: [...dna.colors, { name: "New", hex: "#6366f1" }] });

  return (
    <SectionCard
      icon={Palette}
      title="Color palette"
      hint={`${dna.colors.length} color${dna.colors.length === 1 ? "" : "s"}`}
      source={source}
    >
      {dna.colors.length === 0 ? (
        <EmptyAction onClick={addColor} label="Add brand color" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {dna.colors.map((c, i) => (
            <ColorChip
              key={i}
              color={c}
              onChange={(p) => updateColor(i, p)}
              onRemove={() => removeColor(i)}
            />
          ))}
          <button
            onClick={addColor}
            className="grid h-[140px] place-items-center rounded-xl border border-dashed border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
            aria-label="Add color"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}
    </SectionCard>
  );
}

function ColorChip({
  color,
  onChange,
  onRemove,
}: {
  color: BrandColor;
  onChange: (p: Partial<BrandColor>) => void;
  onRemove: () => void;
}) {
  const fg = readableOn(color.hex);
  const [editing, setEditing] = useState(false);
  return (
    <div className="group relative overflow-hidden rounded-xl ring-1 ring-border/60">
      <div className="relative h-[100px]" style={{ backgroundColor: color.hex, color: fg }}>
        <input
          type="color"
          value={color.hex}
          onChange={(e) => onChange({ hex: e.target.value })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick color"
        />
        <button
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Remove color"
        >
          <X className="h-3 w-3" />
        </button>
        <span
          className="absolute left-2 bottom-2 text-[11px] font-mono uppercase tracking-wider"
          style={{ color: fg }}
        >
          {color.hex.toUpperCase()}
        </span>
      </div>
      <div className="flex items-center gap-1 bg-[hsl(var(--card))] px-2 py-1.5">
        {editing ? (
          <Input
            autoFocus
            value={color.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditing(false)}
            className="h-6 border-0 bg-transparent px-0 text-[11.5px] focus-visible:ring-0"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex-1 truncate text-left text-[11.5px] text-foreground/85 hover:text-foreground"
          >
            {color.name}
          </button>
        )}
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </div>
    </div>
  );
}

/* ─────────── FONTS ─────────── */

function FontCard({
  dna,
  save,
  source,
}: {
  dna: BrandDna;
  save: (n: Partial<BrandDna>) => void;
  source?: BrandSource;
}) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v) return;
    save({ fonts: Array.from(new Set([...dna.fonts, v])).slice(0, 3) });
    setVal("");
  };
  return (
    <SectionCard icon={Type} title="Typography" hint={`${dna.fonts.length}/3`} source={source}>
      {dna.fonts.length === 0 ? (
        <p className="mb-2 text-[11.5px] text-muted-foreground">
          No fonts detected. Add the families you use.
        </p>
      ) : (
        <div className="space-y-2">
          {dna.fonts.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 p-3"
            >
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  {i === 0 ? "Display" : i === 1 ? "Body" : "Mono"}
                </div>
                <div
                  className="truncate text-[22px] leading-tight text-foreground"
                  style={{ fontFamily: `'${f}', ui-sans-serif, system-ui` }}
                >
                  {f}
                </div>
                <div
                  className="mt-0.5 truncate text-[12px] text-muted-foreground"
                  style={{ fontFamily: `'${f}', ui-sans-serif, system-ui` }}
                >
                  Aa Bb Cc · 0123 · The quick brown fox
                </div>
              </div>
              <button
                onClick={() => save({ fonts: dna.fonts.filter((_, idx) => idx !== i) })}
                className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                aria-label="Remove font"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {dna.fonts.length < 3 && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="e.g. Inter"
            className="h-8"
          />
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────── CHANNELS ─────────── */

function ChannelChips({ dna, source }: { dna: BrandDna; source?: BrandSource }) {
  return (
    <SectionCard
      icon={Megaphone}
      title="Channels"
      hint={`${dna.socials.length} found`}
      source={source}
    >
      {dna.socials.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">No social links found on your site.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {dna.socials.map((s, i) => {
            const key = PLATFORM_KEYS[s.platform];
            return (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 text-[12px] text-foreground/85 hover:border-foreground/30 hover:bg-card transition-colors"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary/80 text-foreground/70 group-hover:text-foreground">
                  {key ? <BrandLogo name={key} brand size={16} /> : <Globe className="h-4 w-4" />}
                </span>
                <span className="truncate capitalize">{s.platform}</span>
              </a>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/* ─────────── INFO + RULES ─────────── */

function InfoGrid({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EditableField
        id="dna-field-brandName"
        icon={Sparkles}
        label="Brand name"
        value={dna.brandName}
        onChange={(brandName) => save({ brandName })}
        source={dna.sources?.brandName}
      />
      <EditableField
        id="dna-field-oneLiner"
        icon={Sparkles}
        label="Tagline"
        value={dna.oneLiner}
        onChange={(oneLiner) => save({ oneLiner })}
        source={dna.sources?.oneLiner}
      />
      <EditableField
        id="dna-field-industry"
        icon={Building2}
        label="Industry"
        value={dna.industry}
        onChange={(industry) => save({ industry })}
        source={dna.sources?.industry}
      />
      <EditableField
        id="dna-field-businessModel"
        icon={ShoppingBag}
        label="Business model"
        value={dna.businessModel}
        onChange={(businessModel) => save({ businessModel })}
        source={dna.sources?.businessModel}
      />
      <EditableField
        id="dna-field-about"
        icon={Brain}
        label="About"
        value={dna.about}
        onChange={(about) => save({ about })}
        multiline
        className="md:col-span-2"
        source={dna.sources?.about}
      />
      <EditableField
        id="dna-field-voice"
        icon={Megaphone}
        label="Voice & tone"
        value={dna.voice}
        onChange={(voice) => save({ voice })}
        multiline
        source={dna.sources?.voice}
      />
      <EditableField
        id="dna-field-products"
        icon={ShoppingBag}
        label="Products / offers"
        value={dna.products}
        onChange={(products) => save({ products })}
        multiline
      />
    </div>
  );
}

function RulesGrid({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EditableField
        id="dna-field-doRules"
        icon={ShieldCheck}
        label="Always do"
        value={dna.doRules}
        onChange={(doRules) => save({ doRules })}
        multiline
        accent="green"
      />
      <EditableField
        id="dna-field-dontRules"
        icon={AlertTriangle}
        label="Never do"
        value={dna.dontRules}
        onChange={(dontRules) => save({ dontRules })}
        multiline
        accent="red"
      />
    </div>
  );
}

function EditableField({
  id,
  icon: Icon,
  label,
  value,
  onChange,
  multiline,
  className,
  accent,
  source,
}: {
  id?: string;
  icon: any;
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
  accent?: "green" | "red";
  source?: BrandSource;
}) {
  const ringClass =
    accent === "green"
      ? "ring-[hsl(var(--brand-green)/0.35)]"
      : accent === "red"
        ? "ring-rose-500/30"
        : "ring-border/60";
  return (
    <div
      id={id}
      className={cn(
        "group rounded-xl bg-card/60 p-3.5 ring-1 transition-all hover:bg-card/80 hover:ring-border/80",
        ringClass,
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Icon className="h-3 w-3" /> {label}
        </div>
        <SourceBadge source={source} />
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={`Add ${label.toLowerCase()}…`}
          className="w-full resize-none rounded-md border-0 bg-transparent p-0 text-[13.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}…`}
          className="h-7 border-0 bg-transparent p-0 text-[14px] font-medium text-foreground focus-visible:ring-0"
        />
      )}
    </div>
  );
}

/* ─────────── TAGS ─────────── */

function TagsCard({
  title,
  icon: Icon,
  tags,
  onChange,
  placeholder,
  source,
}: {
  title: string;
  icon: any;
  tags: string[];
  onChange: (t: string[]) => void;
  placeholder?: string;
  source?: BrandSource;
}) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v) return;
    onChange(Array.from(new Set([...tags, v])).slice(0, 8));
    setVal("");
  };
  return (
    <SectionCard icon={Icon} title={title} hint={`${tags.length}/8`} source={source}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t, i) => (
          <span
            key={i}
            className="group inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1 text-[11.5px] text-foreground/85"
          >
            {t}
            <button
              onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
              className="opacity-50 hover:opacity-100"
              aria-label={`Remove ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={tags.length === 0 ? (placeholder ?? "Add tag…") : "Add…"}
          className="h-7 min-w-[120px] flex-1 rounded-full border border-dashed border-border/70 bg-transparent px-2.5 text-[11.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/40"
        />
      </div>
    </SectionCard>
  );
}

/* ─────────── PRIMITIVES ─────────── */

function SectionCard({
  icon: Icon,
  title,
  hint,
  source,
  children,
}: {
  icon: any;
  title: string;
  hint?: string;
  source?: BrandSource;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5 transition-colors hover:border-border/80">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary/70 ring-1 ring-border/60">
            <Icon className="h-3.5 w-3.5 text-foreground/80" />
          </span>
          {title}
        </div>
        <div className="flex items-center gap-2">
          {hint && <span className="text-[11px] tabular-nums text-muted-foreground">{hint}</span>}
          <SourceBadge source={source} />
        </div>
      </header>
      {children}
    </section>
  );
}

function EmptyAction({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="grid w-full place-items-center rounded-2xl border border-dashed border-border/70 py-7 text-[12.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-card/40 hover:text-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <Plus className="h-3.5 w-3.5" /> {label}
      </span>
    </button>
  );
}

/* ─────────── MEMORY TABS ─────────── */

export type MemoryTabKey =
  "brand" | "essentials" | "competitors" | "customers" | "assets" | "notes";

/* ─────────── POSITIONING ─────────── */

function PositioningGrid({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EditableField
        id="dna-field-mission"
        icon={Sparkles}
        label="Mission"
        value={dna.mission}
        onChange={(mission) => save({ mission })}
        multiline
      />
      <EditableField
        id="dna-field-vision"
        icon={Sparkles}
        label="Vision"
        value={dna.vision}
        onChange={(vision) => save({ vision })}
        multiline
      />
      <EditableField
        id="dna-field-positioning"
        icon={Building2}
        label="Positioning"
        value={dna.positioning}
        onChange={(positioning) => save({ positioning })}
        multiline
        className="md:col-span-2"
      />
      <EditableField
        id="dna-field-uvp"
        icon={ShieldCheck}
        label="Unique value prop"
        value={dna.uniqueValueProp}
        onChange={(uniqueValueProp) => save({ uniqueValueProp })}
        multiline
        className="md:col-span-2"
      />
    </div>
  );
}

/* ─────────── COMPETITORS ─────────── */

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function CompetitorsTab({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  const add = () => save({ competitors: [...dna.competitors, { id: uid(), name: "", url: "" }] });
  const update = (id: string, patch: Partial<import("@/hooks/use-brand-dna").Competitor>) =>
    save({ competitors: dna.competitors.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) => save({ competitors: dna.competitors.filter((c) => c.id !== id) });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80 inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Competitors
        </div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add competitor
        </Button>
      </div>
      {dna.competitors.length === 0 && (
        <EmptyAction onClick={add} label="Track your first competitor" />
      )}
      <div className="space-y-3">
        {dna.competitors.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={c.name}
                onChange={(e) => update(c.id, { name: e.target.value })}
                placeholder="Competitor name"
                className="h-8 text-[13px] font-medium"
              />
              <Input
                value={c.url ?? ""}
                onChange={(e) => update(c.id, { url: e.target.value })}
                placeholder="https://…"
                className="h-8 text-[12px]"
              />
              <button
                onClick={() => remove(c.id)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <MiniField
                label="Positioning"
                value={c.positioning ?? ""}
                onChange={(v) => update(c.id, { positioning: v })}
              />
              <MiniField
                label="Pricing"
                value={c.pricing ?? ""}
                onChange={(v) => update(c.id, { pricing: v })}
              />
              <MiniField
                label="Strengths"
                value={c.strengths ?? ""}
                onChange={(v) => update(c.id, { strengths: v })}
                multiline
              />
              <MiniField
                label="Weaknesses"
                value={c.weaknesses ?? ""}
                onChange={(v) => update(c.id, { weaknesses: v })}
                multiline
              />
              <MiniField
                label="Notes"
                value={c.notes ?? ""}
                onChange={(v) => update(c.id, { notes: v })}
                multiline
                className="md:col-span-2"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────── CUSTOMERS ─────────── */

function CustomersTab({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  const c = dna.customer;
  const upd = (patch: Partial<typeof c>) => save({ customer: { ...c, ...patch } });

  const addPersona = () => upd({ personas: [...c.personas, { id: uid(), name: "New persona" }] });
  const updPersona = (id: string, patch: Partial<import("@/hooks/use-brand-dna").Persona>) =>
    upd({ personas: c.personas.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const rmPersona = (id: string) => upd({ personas: c.personas.filter((p) => p.id !== id) });

  const addTestimonial = () => upd({ testimonials: [...c.testimonials, { id: uid(), quote: "" }] });
  const updTestimonial = (
    id: string,
    patch: Partial<import("@/hooks/use-brand-dna").Testimonial>,
  ) => upd({ testimonials: c.testimonials.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const rmTestimonial = (id: string) =>
    upd({ testimonials: c.testimonials.filter((t) => t.id !== id) });

  type SignalKey = "triggerSignals" | "objectionSignals" | "feedbackSources";
  const addSignal = (key: SignalKey) =>
    upd({ [key]: [...(c[key] ?? []), { id: uid(), text: "", capturedAt: Date.now() }] } as Partial<
      typeof c
    >);
  const updSignal = (
    key: SignalKey,
    id: string,
    patch: Partial<import("@/hooks/use-brand-dna").SignalEvidence>,
  ) =>
    upd({ [key]: (c[key] ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)) } as Partial<
      typeof c
    >);
  const rmSignal = (key: SignalKey, id: string) =>
    upd({ [key]: (c[key] ?? []).filter((s) => s.id !== id) } as Partial<typeof c>);

  return (
    <div className="space-y-5">
      <SectionCard
        icon={Sparkles}
        title="Customer signals"
        hint="Evidence-backed buying triggers, objections & feedback sources"
      >
        <div className="space-y-4">
          <EvidenceList
            label="Buying triggers"
            description="Moments or events that push prospects to act."
            placeholder="e.g. Hit 50 customers and lost track of replies"
            sourcePlaceholder="Sales call, G2 review…"
            tone="hsl(var(--brand-green))"
            items={c.triggerSignals}
            onAdd={() => addSignal("triggerSignals")}
            onChange={(id, p) => updSignal("triggerSignals", id, p)}
            onRemove={(id) => rmSignal("triggerSignals", id)}
          />
          <EvidenceList
            label="Objections"
            description="Concerns prospects raise before committing."
            placeholder="e.g. Worried our team can't migrate in a week"
            sourcePlaceholder="Demo, churn interview…"
            tone="hsl(var(--warning, 30 95% 56%))"
            items={c.objectionSignals}
            onAdd={() => addSignal("objectionSignals")}
            onChange={(id, p) => updSignal("objectionSignals", id, p)}
            onRemove={(id) => rmSignal("objectionSignals", id)}
          />
          <EvidenceList
            label="Feedback sources"
            description="Where the signals above came from — links matter."
            placeholder="e.g. 12 NPS verbatims mentioning slow onboarding"
            sourcePlaceholder="https://… or 'Support inbox'"
            tone="hsl(var(--brand-blue))"
            items={c.feedbackSources}
            onAdd={() => addSignal("feedbackSources")}
            onChange={(id, p) => updSignal("feedbackSources", id, p)}
            onRemove={(id) => rmSignal("feedbackSources", id)}
          />
        </div>
      </SectionCard>

      <SectionCard icon={Users} title="Customer notes" hint="Free-text context every agent reads">
        <div className="grid gap-4 md:grid-cols-2">
          <MiniField
            label="Jobs to be done"
            value={c.jobsToBeDone}
            onChange={(v) => upd({ jobsToBeDone: v })}
            multiline
          />
          <MiniField
            label="Top pain points"
            value={c.painPoints}
            onChange={(v) => upd({ painPoints: v })}
            multiline
          />
          <MiniField
            label="Decision criteria"
            value={c.decisionCriteria}
            onChange={(v) => upd({ decisionCriteria: v })}
            multiline
          />
          <MiniField
            label="Where they hang out"
            value={c.channels}
            onChange={(v) => upd({ channels: v })}
            multiline
          />
        </div>
      </SectionCard>

      <SectionCard icon={Users} title="Personas" hint={`${c.personas.length}`}>
        {c.personas.length === 0 && <EmptyAction onClick={addPersona} label="Add a persona" />}
        <div className="space-y-3">
          {c.personas.map((p) => (
            <div key={p.id} className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={p.name}
                  onChange={(e) => updPersona(p.id, { name: e.target.value })}
                  placeholder="Persona name"
                  className="h-8 text-[13px] font-medium"
                />
                <Input
                  value={p.role ?? ""}
                  onChange={(e) => updPersona(p.id, { role: e.target.value })}
                  placeholder="Role / title"
                  className="h-8 text-[12px]"
                />
                <Input
                  value={p.segment ?? ""}
                  onChange={(e) => updPersona(p.id, { segment: e.target.value })}
                  placeholder="Segment"
                  className="h-8 text-[12px]"
                />
                <button
                  onClick={() => rmPersona(p.id)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <MiniField
                  label="Goals"
                  value={p.goals ?? ""}
                  onChange={(v) => updPersona(p.id, { goals: v })}
                  multiline
                />
                <MiniField
                  label="Pain points"
                  value={p.painPoints ?? ""}
                  onChange={(v) => updPersona(p.id, { painPoints: v })}
                  multiline
                />
                <MiniField
                  label="Objections"
                  value={p.objections ?? ""}
                  onChange={(v) => updPersona(p.id, { objections: v })}
                  multiline
                />
                <MiniField
                  label="Preferred channels"
                  value={p.channels ?? ""}
                  onChange={(v) => updPersona(p.id, { channels: v })}
                />
              </div>
            </div>
          ))}
        </div>
        {c.personas.length > 0 && (
          <Button size="sm" variant="outline" onClick={addPersona} className="mt-3">
            <Plus className="h-3.5 w-3.5" /> Add persona
          </Button>
        )}
      </SectionCard>

      <SectionCard icon={Megaphone} title="Testimonials & quotes" hint={`${c.testimonials.length}`}>
        {c.testimonials.length === 0 && (
          <EmptyAction onClick={addTestimonial} label="Add a testimonial" />
        )}
        <div className="space-y-2">
          {c.testimonials.map((t) => (
            <div key={t.id} className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
              <textarea
                value={t.quote}
                onChange={(e) => updTestimonial(t.id, { quote: e.target.value })}
                placeholder="“This product saved us 10 hours a week.”"
                rows={2}
                className="w-full resize-none rounded-md border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-0"
              />
              <div className="flex items-center gap-2">
                <Input
                  value={t.author ?? ""}
                  onChange={(e) => updTestimonial(t.id, { author: e.target.value })}
                  placeholder="Author"
                  className="h-7 text-[12px]"
                />
                <Input
                  value={t.role ?? ""}
                  onChange={(e) => updTestimonial(t.id, { role: e.target.value })}
                  placeholder="Role / Company"
                  className="h-7 text-[12px]"
                />
                <Input
                  value={t.source ?? ""}
                  onChange={(e) => updTestimonial(t.id, { source: e.target.value })}
                  placeholder="Source URL"
                  className="h-7 text-[12px]"
                />
                <button
                  onClick={() => rmTestimonial(t.id)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        {c.testimonials.length > 0 && (
          <Button size="sm" variant="outline" onClick={addTestimonial} className="mt-3">
            <Plus className="h-3.5 w-3.5" /> Add testimonial
          </Button>
        )}
      </SectionCard>
    </div>
  );
}

/* ─────────── ASSETS ─────────── */

function AssetsTab({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  const add = () =>
    save({ assets: [...dna.assets, { id: uid(), label: "", url: "", kind: "link" }] });
  const update = (id: string, patch: Partial<import("@/hooks/use-brand-dna").AssetItem>) =>
    save({ assets: dna.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const remove = (id: string) => save({ assets: dna.assets.filter((a) => a.id !== id) });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80 inline-flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" /> Designs, assets & references
        </div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add asset
        </Button>
      </div>
      {dna.assets.length === 0 && (
        <EmptyAction onClick={add} label="Add Figma, brand kit, drive folder…" />
      )}
      <div className="grid gap-2">
        {dna.assets.map((a) => (
          <div
            key={a.id}
            className="grid grid-cols-[110px_1fr_1.4fr_28px] items-center gap-2 rounded-xl border border-border/60 bg-card/60 p-2"
          >
            <select
              value={a.kind ?? "link"}
              onChange={(e) => update(a.id, { kind: e.target.value as any })}
              className="h-8 rounded-md border border-border/60 bg-transparent px-2 text-[12px]"
            >
              <option value="link">Link</option>
              <option value="design">Design</option>
              <option value="logo">Logo</option>
              <option value="image">Image</option>
              <option value="doc">Doc</option>
              <option value="video">Video</option>
            </select>
            <Input
              value={a.label}
              onChange={(e) => update(a.id, { label: e.target.value })}
              placeholder="Label"
              className="h-8 text-[12px]"
            />
            <Input
              value={a.url}
              onChange={(e) => update(a.id, { url: e.target.value })}
              placeholder="https://…"
              className="h-8 text-[12px]"
            />
            <button
              onClick={() => remove(a.id)}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
              aria-label="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────── NOTES / HISTORY ─────────── */

function NotesTab({ dna, save }: { dna: BrandDna; save: (n: Partial<BrandDna>) => void }) {
  const add = () =>
    save({
      notes: [{ id: uid(), title: "New note", body: "", createdAt: Date.now() }, ...dna.notes],
    });
  const update = (id: string, patch: Partial<import("@/hooks/use-brand-dna").MemoryNote>) =>
    save({ notes: dna.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  const remove = (id: string) => save({ notes: dna.notes.filter((n) => n.id !== id) });

  return (
    <section className="space-y-5">
      {/* Auto-extracted user insights from chat */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80 inline-flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-[hsl(var(--brand-green))]" /> Insights from chat
            <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground normal-case tracking-normal">
              {dna.userInsights.length}
            </span>
          </div>
          {dna.memoryUpdatedAt ? (
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              Synced {new Date(dna.memoryUpdatedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        {dna.userInsights.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 px-3 py-3 text-[12px] text-muted-foreground">
            Durable user statements (preferences, decisions, brand facts) auto-saved from chat will
            appear here. Hit "Sync from chat" below.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {dna.userInsights.map((n) => (
              <li
                key={n.id}
                className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-green))]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{n.title}</div>
                  {n.body ? (
                    <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      {n.body}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() =>
                    save({ userInsights: dna.userInsights.filter((x) => x.id !== n.id) })
                  }
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-secondary/80 hover:text-foreground"
                  aria-label="Remove insight"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual notes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80 inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Notes & history
          </div>
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add note
          </Button>
        </div>
        {dna.notes.length === 0 && (
          <EmptyAction onClick={add} label="Capture a learning, decision or context" />
        )}
        <div className="space-y-2">
          {dna.notes.map((n) => (
            <div key={n.id} className="rounded-xl border border-border/60 bg-card/60 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={n.title}
                  onChange={(e) => update(n.id, { title: e.target.value })}
                  placeholder="Title"
                  className="h-8 text-[13px] font-medium"
                />
                <span className="text-[10.5px] text-muted-foreground tabular-nums">
                  {new Date(n.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => remove(n.id)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <textarea
                value={n.body}
                onChange={(e) => update(n.id, { body: e.target.value })}
                rows={3}
                placeholder="What happened, what did you decide, what should agents remember?"
                className="w-full resize-y rounded-md border-0 bg-transparent p-0 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-0"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────── MINI FIELD ─────────── */

function MiniField({
  label,
  value,
  onChange,
  multiline,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg bg-card/60 p-2.5 ring-1 ring-border/60", className)}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={`Add ${label.toLowerCase()}…`}
          className="w-full resize-none border-0 bg-transparent p-0 text-[12.5px] outline-none placeholder:text-muted-foreground focus:ring-0"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}…`}
          className="h-7 border-0 bg-transparent p-0 text-[12.5px] focus-visible:ring-0"
        />
      )}
    </div>
  );
}

/* ─────────── EVIDENCE LIST (signals with sources) ─────────── */

type SignalEvidence = import("@/hooks/use-brand-dna").SignalEvidence;

function EvidenceList({
  label,
  description,
  placeholder,
  sourcePlaceholder,
  tone,
  items,
  onAdd,
  onChange,
  onRemove,
}: {
  label: string;
  description: string;
  placeholder: string;
  sourcePlaceholder: string;
  tone: string;
  items: SignalEvidence[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<SignalEvidence>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: tone }} />
            <span className="text-[12px] font-semibold text-foreground">{label}</span>
            <span className="rounded bg-secondary/80 px-1 text-[10px] tabular-nums text-muted-foreground">
              {items.length}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onAdd} className="h-7 px-2 text-[11.5px]">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {items.length === 0 ? (
        <button
          onClick={onAdd}
          className="block w-full rounded-lg border border-dashed border-border/60 bg-transparent px-3 py-3 text-left text-[12px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
        >
          + Capture a {label.toLowerCase()} signal with the source it came from
        </button>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-lg border border-border/60 bg-card/70 p-2.5"
              style={{ borderLeft: `2px solid ${tone}` }}
            >
              <textarea
                value={it.text}
                onChange={(e) => onChange(it.id, { text: e.target.value })}
                rows={2}
                placeholder={placeholder}
                className="w-full resize-none rounded-md border-0 bg-transparent p-0 text-[12.5px] outline-none placeholder:text-muted-foreground focus:ring-0"
              />
              <div className="mt-2 grid grid-cols-[1fr_1.4fr_28px] items-center gap-2">
                <Input
                  value={it.sourceLabel ?? ""}
                  onChange={(e) => onChange(it.id, { sourceLabel: e.target.value })}
                  placeholder={sourcePlaceholder}
                  className="h-7 text-[11.5px]"
                />
                <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card/50 px-2">
                  <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Input
                    value={it.sourceUrl ?? ""}
                    onChange={(e) => onChange(it.id, { sourceUrl: e.target.value })}
                    placeholder="https://evidence-link…"
                    className="h-7 flex-1 border-0 bg-transparent px-0 text-[11.5px] focus-visible:ring-0"
                  />
                  {it.sourceUrl && (
                    <a
                      href={normalizeUrl(it.sourceUrl) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      title="Open source"
                    >
                      <Globe className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <button
                  onClick={() => onRemove(it.id)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  aria-label="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
