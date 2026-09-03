"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Brain,
  Search,
  ScanLine,
  PenLine,
  ImageIcon,
  CalendarClock,
  TrendingUp,
  Rocket,
  CheckCircle2,
  Globe,
  ExternalLink,
  Compass,
  Database,
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  ThumbsUp,
  Send,
  Wifi,
  Lock,
} from "@/components/ui/gemini-icons";
import type { PreviewStageEvent } from "@/lib/preview-stages";

/**
 * Process view for long-running work. Each stage renders a tailored visual
 * (search results, scan lines, draft typewriter, shimmer image, calendar,
 * metric deltas, success). Sits inside SitePreview's stage card.
 */
export function PreviewStage({ stage }: { stage: PreviewStageEvent }) {
  const accent = `hsl(${stage.hue ?? 260} 85% 60%)`;
  const Icon = ICONS[stage.kind];

  return (
    <motion.div
      key={`${stage.kind}-${stage.index}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[1.62rem]"
    >
      {/* Header: step pill + label */}
      <div className="flex items-center justify-between gap-3 rounded-t-[1.62rem] border-b border-border/60 bg-background/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-2xl"
            style={{ background: `${accent}18`, boxShadow: `inset 0 0 0 1px ${accent}55` }}
          >
            <motion.div
              animate={{ rotate: stage.kind === "complete" ? 0 : 360 }}
              transition={{
                duration: 6,
                repeat: stage.kind === "complete" ? 0 : Infinity,
                ease: "linear",
              }}
              className="absolute inset-0 rounded-2xl"
              style={{
                background: `conic-gradient(from 0deg, transparent, ${accent}66, transparent)`,
                opacity: 0.4,
              }}
            />
            <Icon className="relative h-4 w-4" style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[12.5px] font-semibold tracking-tight text-foreground truncate">
                {stage.label}
              </span>
              {stage.kind !== "complete" && <TypingDots accent={accent} />}
            </div>
            {stage.sub && (
              <div className="text-[10.5px] text-muted-foreground truncate">{stage.sub}</div>
            )}
          </div>
        </div>
        <StepPill index={stage.index} total={stage.total} accent={accent} />
      </div>

      {/* Body: stage-specific visual */}
      <div className="relative flex-1 overflow-hidden rounded-b-[1.62rem]">
        <AnimatePresence mode="wait">
          <motion.div
            key={stage.kind + stage.index}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
          >
            <StageBody stage={stage} accent={accent} />
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const ICONS = {
  thinking: Brain,
  searching: Search,
  browsing: Compass,
  analyzing: ScanLine,
  extracting: Database,
  drafting: PenLine,
  image: ImageIcon,
  scheduling: CalendarClock,
  optimizing: TrendingUp,
  publishing: Rocket,
  complete: CheckCircle2,
} as const;

/* ── Stage bodies ─────────────────────────────────────────────────────── */

function StageBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  switch (stage.kind) {
    case "searching":
      return <SearchingBody stage={stage} accent={accent} />;
    case "browsing":
      return <BrowsingBody stage={stage} accent={accent} />;
    case "analyzing":
      return <AnalyzingBody stage={stage} accent={accent} />;
    case "extracting":
      return <ExtractingBody stage={stage} accent={accent} />;
    case "drafting":
      return <DraftingBody stage={stage} accent={accent} />;
    case "image":
      return <ImageBody stage={stage} accent={accent} />;
    case "scheduling":
      return <SchedulingBody stage={stage} accent={accent} />;
    case "optimizing":
      return <OptimizingBody stage={stage} accent={accent} />;
    case "complete":
      return <CompleteBody stage={stage} accent={accent} />;
    case "thinking":
    default:
      return <ThinkingBody accent={accent} />;
  }
}

function ThinkingBody({ accent }: { accent: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="relative grid place-items-center">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute h-24 w-24 rounded-full"
            style={{ border: `1.5px solid ${accent}` }}
            animate={{ scale: [0.6, 1.6], opacity: [0.6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
          />
        ))}
        <motion.div
          className="grid h-14 w-14 place-items-center rounded-2xl"
          style={{ background: `${accent}22`, boxShadow: `0 0 28px ${accent}55` }}
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Brain className="h-6 w-6" style={{ color: accent }} />
        </motion.div>
      </div>
    </div>
  );
}

function SearchingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const q = stage.data?.query ?? "your brand";
  const results = stage.data?.results ?? [];
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Search bar */}
      <div
        className="flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm"
        style={{ borderColor: `${accent}33` }}
      >
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground truncate">{q}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <motion.span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          live
        </span>
      </div>
      {/* Results */}
      <div className="flex-1 space-y-1.5 overflow-hidden">
        {results.slice(0, 4).map((r, i) => (
          <motion.div
            key={r.url + i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.18, duration: 0.35 }}
            className="rounded-lg border bg-background/60 px-3 py-2"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Globe className="h-3 w-3" />
              <span className="truncate">{r.url}</span>
            </div>
            <div className="mt-0.5 truncate text-[12px] font-medium" style={{ color: accent }}>
              {r.title}
            </div>
            {r.snippet && (
              <div className="truncate text-[10.5px] text-muted-foreground">{r.snippet}</div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function AnalyzingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const targets = [
    "Hero copy",
    "Primary CTA",
    "Meta description",
    "H1 / H2 structure",
    "Schema markup",
    "Open Graph",
  ];
  const shot = stage.data?.screenshotUrl;
  const host = stage.data?.siteUrl ? hostOnly(stage.data.siteUrl) : null;
  return (
    <div className="relative flex h-full w-full flex-col p-3">
      <BrowserChrome url={host ?? "your-site.com"} accent={accent} />
      <div
        className="relative flex-1 overflow-hidden rounded-b-2xl border border-t-0"
        style={{ borderColor: `${accent}44` }}
      >
        {/* Real site screenshot underneath the scanner */}
        {shot ? (
          <img
            src={shot}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-top opacity-70"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage: `linear-gradient(${accent}66 1px, transparent 1px), linear-gradient(90deg, ${accent}66 1px, transparent 1px)`,
              backgroundSize: "24px 24px",
            }}
          />
        )}
        <div className="absolute inset-0 bg-background/30 backdrop-blur-[1px]" />
        {/* scanner */}
        <motion.div
          className="absolute inset-x-0 h-20"
          initial={{ y: "-30%" }}
          animate={{ y: "120%" }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            background: `linear-gradient(to bottom, transparent, ${accent}44, transparent)`,
            filter: "blur(2px)",
          }}
        />
        <motion.div
          className="absolute inset-x-0 h-px"
          initial={{ y: "-20%" }}
          animate={{ y: "110%" }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
        />
        {/* checklist — floats over screenshot */}
        <div className="relative grid h-full grid-cols-2 gap-1.5 p-3 content-center">
          {targets.map((t, i) => (
            <motion.div
              key={t}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.12 }}
              className="flex items-center gap-1.5 rounded-md bg-background/85 px-2 py-1.5 backdrop-blur"
              style={{ boxShadow: `inset 0 0 0 1px ${accent}33` }}
            >
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: accent }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
              />
              <span className="truncate text-[10.5px] font-medium">{t}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Browser chrome (used by Analyzing, Browsing, Searching) ─────────── */

function BrowserChrome({
  url,
  accent,
  tabs,
  activeTab = 0,
}: {
  url: string;
  accent: string;
  tabs?: { url: string; title: string }[];
  activeTab?: number;
}) {
  return (
    <div
      className="rounded-t-2xl border border-b-0 bg-card/95 backdrop-blur"
      style={{ borderColor: `${accent}44` }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]" />
        </div>
        <div
          className="ml-1 flex flex-1 items-center gap-1.5 rounded-md border bg-background/70 px-2 py-1 text-[10px] text-muted-foreground"
          style={{ borderColor: `${accent}33` }}
        >
          <Lock className="h-2.5 w-2.5" style={{ color: accent }} />
          <span className="truncate font-mono">{url}</span>
          <motion.span
            className="ml-auto inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: accent }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        </div>
        <Wifi className="h-2.5 w-2.5 text-muted-foreground" />
      </div>
      {/* Tab strip */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-end gap-0.5 overflow-hidden px-2">
          {tabs.slice(0, 5).map((t, i) => (
            <motion.div
              key={t.url + i}
              initial={{ y: 4, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.08 }}
              className="flex max-w-[120px] items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-[9.5px]"
              style={{
                borderColor: i === activeTab ? `${accent}66` : `${accent}22`,
                background: i === activeTab ? "hsl(var(--background))" : `${accent}10`,
                color: i === activeTab ? accent : "hsl(var(--muted-foreground))",
                fontWeight: i === activeTab ? 600 : 400,
              }}
            >
              <Globe className="h-2 w-2 shrink-0" />
              <span className="truncate">{t.url}</span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Browsing (competitor / URL deep-dive) ───────────────────────────── */

function BrowsingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const tabs = stage.data?.tabs ?? [];
  const [active, setActive] = useTabRotator(tabs.length);
  const current = tabs[active];
  return (
    <div className="flex h-full flex-col p-3">
      <BrowserChrome
        url={current?.url ?? "loading…"}
        accent={accent}
        tabs={tabs}
        activeTab={active}
      />
      <div
        className="relative flex-1 overflow-hidden rounded-b-2xl border border-t-0 bg-background/50"
        style={{ borderColor: `${accent}44` }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 flex flex-col gap-2 p-3"
          >
            {/* mock site skeleton */}
            <div className="h-3 w-1/3 rounded" style={{ background: `${accent}55` }} />
            <div className="flex gap-2">
              <div className="h-16 flex-1 rounded-md" style={{ background: `${accent}22` }} />
              <div className="h-16 w-24 rounded-md border" style={{ borderColor: `${accent}55` }} />
            </div>
            <div className="h-2 w-2/3 rounded bg-foreground/15" />
            <div className="h-2 w-1/2 rounded bg-foreground/10" />
            <div
              className="mt-auto flex items-center gap-2 rounded-md bg-background/70 p-2"
              style={{ boxShadow: `inset 0 0 0 1px ${accent}33` }}
            >
              <span
                className="grid h-5 w-5 place-items-center rounded-full"
                style={{ background: `${accent}33` }}
              >
                <Compass className="h-3 w-3" style={{ color: accent }} />
              </span>
              <span className="truncate text-[10.5px] font-medium" style={{ color: accent }}>
                {current?.title ?? "Browsing…"}
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      {/* source citations strip — Manus-style */}
      <div className="mt-2 flex items-center gap-1 overflow-hidden">
        <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Sources</span>
        {tabs.map((t, i) => (
          <span
            key={t.url + i}
            className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold"
            style={{
              background: i === active ? accent : `${accent}33`,
              color: i === active ? "white" : accent,
            }}
            title={t.url}
          >
            {t.url.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function useTabRotator(count: number): [number, (n: number) => void] {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const id = setInterval(() => setI((p: number) => (p + 1) % count), 1400);
    return () => clearInterval(id);
  }, [count]);
  return [i, setI];
}

/* ── Extracting (structured signals from browsed pages) ──────────────── */

function ExtractingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const rows = stage.data?.rows ?? [];
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Database className="h-3 w-3" style={{ color: accent }} />
        Structured extract
      </div>
      <div
        className="flex-1 overflow-hidden rounded-2xl border bg-card"
        style={{ borderColor: `${accent}33` }}
      >
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            initial={{ opacity: 0, x: -8, backgroundColor: `${accent}33` }}
            animate={{ opacity: 1, x: 0, backgroundColor: "transparent" }}
            transition={{ delay: 0.15 + i * 0.25, duration: 0.5 }}
            className="grid grid-cols-[40%_1fr] items-center gap-2 border-b px-3 py-2 last:border-b-0"
            style={{ borderColor: `${accent}22` }}
          >
            <span className="truncate text-[10.5px] text-muted-foreground">{r.label}</span>
            <span
              className="truncate text-[11px] font-medium tabular-nums"
              style={{ color: accent }}
            >
              <TypewriterText text={r.value} delay={0.2 + i * 0.25} />
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TypewriterText({ text, delay }: { text: string; delay: number }) {
  return (
    <motion.span
      initial={{ width: 0 }}
      animate={{ width: "100%" }}
      transition={{ delay, duration: Math.max(0.3, text.length * 0.02), ease: "linear" }}
      className="inline-block overflow-hidden whitespace-nowrap align-bottom"
    >
      {text}
    </motion.span>
  );
}

function DraftingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const lines = stage.data?.draftLines ?? [];
  const kind = stage.data?.draftKind ?? "blog";
  if (kind === "instagram") return <InstagramDraft lines={lines} accent={accent} />;
  if (kind === "tweet") return <TweetDraft lines={lines} accent={accent} />;
  if (kind === "linkedin") return <LinkedInDraft lines={lines} accent={accent} />;
  if (kind === "email") return <EmailDraft lines={lines} accent={accent} />;
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <PenLine className="h-3 w-3" style={{ color: accent }} />
        Blog draft · live
      </div>
      <div className="flex-1 overflow-hidden rounded-2xl border bg-card p-4 font-mono text-[11.5px] leading-relaxed">
        {lines.map((line, i) => (
          <Typewriter key={i} text={line} delay={i * 0.55} accent={accent} />
        ))}
        <motion.span
          className="ml-0.5 inline-block h-3 w-1.5 align-middle"
          style={{ background: accent }}
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
      </div>
    </div>
  );
}

function InstagramDraft({ lines, accent }: { lines: string[]; accent: string }) {
  const caption = lines.filter((l) => !l.startsWith("#") && l.trim()).join(" ");
  const tags = lines.find((l) => l.startsWith("#")) ?? "";
  return (
    <div className="flex h-full items-center justify-center p-3">
      <div
        className="w-full max-w-[260px] overflow-hidden rounded-2xl border bg-card shadow-xl"
        style={{ borderColor: `${accent}33` }}
      >
        {/* header */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div
            className="h-7 w-7 rounded-full"
            style={{
              background: `conic-gradient(from 0deg, ${accent}, hsl(320 90% 60%), ${accent})`,
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold">your.brand</div>
            <div className="truncate text-[9px] text-muted-foreground">Sponsored · just now</div>
          </div>
        </div>
        {/* image */}
        <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-foreground/5 to-foreground/15">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute inset-x-0 h-8"
              style={{
                top: `${i * 30}%`,
                background: `linear-gradient(90deg, transparent, ${accent}55, transparent)`,
                filter: "blur(6px)",
              }}
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
            />
          ))}
          <div className="absolute inset-0 grid place-items-center">
            <ImageIcon className="h-8 w-8" style={{ color: `${accent}88` }} />
          </div>
        </div>
        {/* actions */}
        <div className="flex items-center gap-3 px-3 pt-2 text-muted-foreground">
          <Heart className="h-3.5 w-3.5" />
          <MessageCircle className="h-3.5 w-3.5" />
          <Send className="h-3.5 w-3.5" />
          <Bookmark className="ml-auto h-3.5 w-3.5" />
        </div>
        {/* caption */}
        <div className="space-y-1 px-3 pb-3 pt-1.5">
          <div className="text-[10.5px] leading-snug">
            <span className="font-semibold">your.brand</span>{" "}
            <TypewriterText text={caption.slice(0, 110)} delay={0.2} />
          </div>
          {tags && (
            <div className="text-[10px]" style={{ color: accent }}>
              <TypewriterText text={tags} delay={0.9} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TweetDraft({ lines, accent }: { lines: string[]; accent: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <div
        className="w-full max-w-[320px] rounded-2xl border bg-card p-3 shadow-xl"
        style={{ borderColor: `${accent}33` }}
      >
        <div className="flex items-start gap-2">
          <div className="h-8 w-8 shrink-0 rounded-full" style={{ background: `${accent}55` }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[11px]">
              <span className="font-semibold">Your brand</span>
              <span className="text-muted-foreground">@yourbrand · 1m</span>
            </div>
            <div className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed">
              {lines.map((l, i) => (
                <div key={i}>
                  <TypewriterText text={l || "\u00a0"} delay={i * 0.35} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3" /> 12
              </span>
              <span className="flex items-center gap-1">
                <Repeat2 className="h-3 w-3" /> 34
              </span>
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3" /> 218
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInDraft({ lines, accent }: { lines: string[]; accent: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <div
        className="w-full max-w-[320px] rounded-2xl border bg-card p-3 shadow-xl"
        style={{ borderColor: `${accent}33` }}
      >
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full" style={{ background: `${accent}55` }} />
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold">Your Brand</div>
            <div className="truncate text-[9.5px] text-muted-foreground">
              Marketing · 1,204 followers · 1m
            </div>
          </div>
        </div>
        <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i}>
              <TypewriterText text={l || "\u00a0"} delay={i * 0.35} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 border-t pt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3" /> Like
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> Comment
          </span>
          <span className="flex items-center gap-1">
            <Repeat2 className="h-3 w-3" /> Repost
          </span>
        </div>
      </div>
    </div>
  );
}

function EmailDraft({ lines, accent }: { lines: string[]; accent: string }) {
  const subject = lines[0]?.replace(/^Subject:\s*/i, "") ?? "";
  const body = lines.slice(2);
  return (
    <div className="flex h-full items-center justify-center p-3">
      <div
        className="w-full max-w-[340px] overflow-hidden rounded-2xl border bg-card shadow-xl"
        style={{ borderColor: `${accent}33` }}
      >
        <div className="border-b px-3 py-2" style={{ borderColor: `${accent}22` }}>
          <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">Subject</div>
          <div className="text-[12px] font-semibold">
            <TypewriterText text={subject} delay={0.1} />
          </div>
        </div>
        <div className="space-y-1 px-3 py-3 text-[11px] leading-relaxed">
          {body.map((l, i) => (
            <div key={i}>
              <TypewriterText text={l || "\u00a0"} delay={0.3 + i * 0.3} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Typewriter({ text, delay, accent }: { text: string; delay: number; accent: string }) {
  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: "100%" }}
      transition={{ delay, duration: Math.max(0.4, text.length * 0.02), ease: "linear" }}
      className="overflow-hidden whitespace-nowrap"
      style={{
        color: text.startsWith("#") ? accent : undefined,
        fontWeight: text.startsWith("#") ? 600 : 400,
      }}
    >
      {text || "\u00a0"}
    </motion.div>
  );
}

function ImageBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const prompt = stage.data?.imagePrompt ?? "On-brand visual";
  return (
    <div className="flex h-full items-center justify-center p-5">
      <div
        className="relative aspect-[4/3] w-full max-w-[280px] overflow-hidden rounded-2xl border bg-card"
        style={{ borderColor: `${accent}55`, boxShadow: `0 20px 40px -20px ${accent}66` }}
      >
        {/* shimmer ribbons */}
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="absolute inset-x-0 h-8"
            style={{
              top: `${i * 22}%`,
              background: `linear-gradient(90deg, transparent, ${accent}55, transparent)`,
              filter: "blur(8px)",
            }}
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.25, ease: "easeInOut" }}
          />
        ))}
        {/* center icon */}
        <div className="absolute inset-0 grid place-items-center">
          <motion.div
            className="grid h-12 w-12 place-items-center rounded-2xl"
            style={{ background: `${accent}33`, boxShadow: `0 0 24px ${accent}88` }}
            animate={{ scale: [1, 1.08, 1], rotate: [0, 6, -6, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <ImageIcon className="h-6 w-6" style={{ color: "white" }} />
          </motion.div>
        </div>
        {/* prompt strip */}
        <div className="absolute inset-x-2 bottom-2 truncate rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
          “{prompt}”
        </div>
      </div>
    </div>
  );
}

function SchedulingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const channels = stage.data?.channels ?? ["Instagram", "LinkedIn", "X"];
  const hours = ["9a", "12p", "3p", "6p", "9p"];
  const pick = 2; // best slot
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-1.5">
        {channels.map((c) => (
          <span
            key={c}
            className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{ borderColor: `${accent}55`, color: accent, background: `${accent}10` }}
          >
            {c}
          </span>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-5 gap-1.5">
        {hours.map((h, i) => (
          <div key={h} className="flex flex-col items-center justify-end gap-1">
            <motion.div
              className="w-full rounded-md"
              style={{
                background: i === pick ? accent : `${accent}33`,
                boxShadow: i === pick ? `0 0 18px ${accent}88` : undefined,
              }}
              initial={{ height: 4 }}
              animate={{ height: [4, 20 + i * 12, 20 + i * 12] }}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.6, ease: "easeOut" }}
            />
            <span className="text-[9.5px] text-muted-foreground">{h}</span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-background/70 px-3 py-1.5 text-[10.5px]">
        Best slot · <span style={{ color: accent, fontWeight: 600 }}>3:00 PM</span> · +38%
        engagement
      </div>
    </div>
  );
}

function OptimizingBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  const metrics = stage.data?.metric ?? [];
  return (
    <div className="flex h-full flex-col justify-center gap-2 p-4">
      {metrics.map((m, i) => {
        const up = m.to >= m.from;
        return (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.12 }}
            className="flex items-center justify-between gap-3 rounded-lg border bg-background/70 px-3 py-2"
          >
            <span className="text-[11px] font-medium text-muted-foreground">{m.label}</span>
            <div className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="text-muted-foreground">
                {m.unit === "$" ? `$${m.from}` : `${m.from}${m.unit ?? ""}`}
              </span>
              <motion.span
                animate={{ x: [0, 3, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                →
              </motion.span>
              <span
                style={{
                  color: up ? "hsl(var(--brand-green))" : "hsl(var(--brand-red, 0 70% 55%))",
                  fontWeight: 600,
                }}
              >
                {m.unit === "$" ? `$${m.to}` : `${m.to}${m.unit ?? ""}`}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function CompleteBody({ stage, accent }: { stage: PreviewStageEvent; accent: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-2"
      >
        <div
          className="grid h-16 w-16 place-items-center rounded-full"
          style={{ background: `${accent}22`, boxShadow: `0 0 36px ${accent}88` }}
        >
          <CheckCircle2 className="h-9 w-9" style={{ color: accent }} />
        </div>
        <div className="text-center">
          <div className="text-[13px] font-semibold tracking-tight">{stage.label}</div>
          {stage.sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{stage.sub}</div>}
        </div>
      </motion.div>
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────────── */

function StepPill({ index, total, accent }: { index: number; total: number; accent: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border bg-background/80 px-2 py-1"
      style={{ borderColor: `${accent}33` }}
    >
      <span className="text-[10px] font-semibold tabular-nums" style={{ color: accent }}>
        {index + 1}/{total}
      </span>
      <div className="flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className="h-1 w-2 rounded-full transition-colors"
            style={{ background: i <= index ? accent : `${accent}33` }}
          />
        ))}
      </div>
    </div>
  );
}

function TypingDots({ accent }: { accent: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full"
          style={{ background: accent }}
          animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function hostOnly(url: string) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
