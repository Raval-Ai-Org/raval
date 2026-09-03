"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Sparkles,
  ShieldCheck,
  Search,
  Bot,
  FileCode2,
  Gauge,
  ListTree,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  RefreshCw,
  ChevronDown,
  Globe,
  Zap,
  Lightbulb,
  Loader2,
  ArrowUpRight,
  Wand2,
  Star,
  Github,
  Plug,
  ExternalLink,
  Wrench,
  Copy,
  Check,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import { authedFetch } from "@/lib/authed-fetch";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { useServerFn } from "@/lib/use-server-fn";
import { persistGeoAudit } from "@/lib/insights.functions";
import { StarAgent as BrandStar, type StarMood } from "@/components/StarAgent";

type CheckStatus = "pass" | "warn" | "fail" | "info";
interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  weight?: number;
}
interface Section {
  id: string;
  title: string;
  blurb: string;
  checks: Check[];
}
interface Subscore {
  id: string;
  title: string;
  score: number;
}
interface ActionItem {
  id: string;
  priority: "high" | "med" | "low";
  title: string;
  detail: string;
}
interface AuditResult {
  url: string;
  fetchedAt: number;
  overall: number;
  subscores: Subscore[];
  actions: ActionItem[];
  sections: Section[];
}

/* ─────────────── Section metadata (colors + icons) ─────────────── */
const SECTION_META: Record<string, { icon: React.ComponentType<any>; hue: number; short: string }> =
  {
    "ai-access": { icon: Bot, hue: 268, short: "AI bots" },
    schema: { icon: FileCode2, hue: 217, short: "Schema" },
    crawl: { icon: Search, hue: 42, short: "Crawl" },
    content: { icon: ListTree, hue: 152, short: "Content" },
    trust: { icon: ShieldCheck, hue: 198, short: "Trust" },
    performance: { icon: Gauge, hue: 4, short: "Perf" },
  };

function StatusGlyph({ status }: { status: CheckStatus }) {
  if (status === "pass")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.4} />;
  if (status === "warn")
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" strokeWidth={2.4} />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-rose-500" strokeWidth={2.4} />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground/70" strokeWidth={2.2} />;
}

function scoreColor(score: number) {
  if (score >= 80) return "hsl(152 70% 45%)";
  if (score >= 55) return "hsl(38 92% 55%)";
  return "hsl(0 75% 58%)";
}

function scoreVerdict(score: number) {
  if (score >= 80) return { label: "Strong", tone: "Engines can confidently cite you." };
  if (score >= 55) return { label: "Workable", tone: "A few fixes will lift your visibility." };
  return { label: "Needs work", tone: "Below the bar for AI citation today." };
}

/* ─────────────── Animated count-up number ─────────────── */
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.3, ease: [0.22, 1, 0.36, 1] });
    return controls.stop;
  }, [value, mv]);
  return <motion.span className={className}>{display}</motion.span>;
}

/* ─────────────── Orbit halo (legacy, kept for ring decoration if needed) ─────────────── */
function OrbitStar({
  size = 28,
  hue = 217,
  idle = false,
}: {
  size?: number;
  hue?: number;
  idle?: boolean;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Soft glow */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full blur-md"
        style={{ background: `hsl(${hue} 80% 60%)`, opacity: 0.35 }}
        animate={{ opacity: idle ? [0.25, 0.45, 0.25] : [0.4, 0.7, 0.4], scale: [1, 1.12, 1] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Core */}
      <motion.span
        className="absolute inset-0 grid place-items-center rounded-full ring-1 ring-white/20"
        style={{
          background: `conic-gradient(from 0deg, hsl(${hue} 80% 62%), hsl(${(hue + 60) % 360} 80% 60%), hsl(${hue} 80% 62%))`,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
      />
      <span className="absolute inset-[2px] grid place-items-center rounded-full bg-background">
        <Sparkles
          className="h-3.5 w-3.5"
          strokeWidth={2.4}
          style={{ color: `hsl(${hue} 75% 58%)` }}
        />
      </span>
      {/* Orbiting micro stars */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute left-1/2 top-1/2 h-0 w-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 6 + i * 2, repeat: Infinity, ease: "linear", delay: i * -1.2 }}
          style={{ translateX: "-50%", translateY: "-50%" }}
        >
          <span className="absolute" style={{ left: size * 0.55, top: -1 - i * 0.5 }}>
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4], scale: [0.7, 1.1, 0.7] }}
              transition={{ duration: 1.6 + i * 0.3, repeat: Infinity, ease: "easeInOut" }}
              className="block"
            >
              <Star
                className="h-2 w-2"
                strokeWidth={0}
                fill={`hsl(${(hue + i * 40) % 360} 90% 70%)`}
              />
            </motion.span>
          </span>
        </motion.span>
      ))}
    </div>
  );
}

/* ─────────────── Hero score ring ─────────────── */
function HeroScoreRing({ value, size = 96 }: { value: number; size?: number }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = scoreColor(value);
  const gradId = `geo-grad-${value}`;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full blur-xl"
        style={{ background: color, opacity: 0.2 }}
        animate={{ opacity: [0.12, 0.26, 0.12], scale: [1, 1.08, 1] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <svg width={size} height={size} className="relative -rotate-90">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="hsl(var(--border))"
          strokeOpacity={0.45}
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {/* Orbiting star around ring */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
      >
        <Star
          className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2"
          strokeWidth={0}
          fill={color}
        />
      </motion.div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-baseline gap-0.5">
          <AnimatedNumber
            value={value}
            className="text-[24px] font-semibold tabular-nums tracking-tight"
          />
          <span className="text-[10px] font-medium text-muted-foreground">/100</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Subscore chip ─────────────── */
function SubscoreChip({ s, i }: { s: Subscore; i: number }) {
  const meta = SECTION_META[s.id];
  const Icon = meta?.icon ?? Info;
  const color = scoreColor(s.score);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="group relative min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/70 px-2 py-2 backdrop-blur-sm transition-colors hover:border-foreground/15 sm:px-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} style={{ color }} />
        <span className="truncate text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground sm:text-[11px]">
          {meta?.short ?? s.title}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className="text-[16px] font-semibold tabular-nums" style={{ color }}>
          {s.score}
        </span>
        <span className="text-[9.5px] text-muted-foreground/70">/100</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/40">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${s.score}%` }}
          transition={{ delay: 0.3 + i * 0.05, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
    </motion.div>
  );
}

/* ─────────────── Fix recipes (snippets the user can apply) ─────────────── */
function fixRecipe(
  action: ActionItem,
): { title: string; code: string; lang: string; placement: string } | null {
  const t = (action.title + " " + action.detail).toLowerCase();
  if (t.includes("llms.txt")) {
    return {
      title: "Publish /llms.txt",
      lang: "txt",
      placement: "Save as public/llms.txt at your project root",
      code: `# llms.txt — guidance for AI engines\n# https://llmstxt.org\n\n# Brand\nName: Your Brand\nSummary: One-line description of what you do.\nURL: https://example.com\n\n# Allowed for AI training & answering\nAllow: /\nDisallow: /admin/\nDisallow: /account/\n\n# Primary sources\n- https://example.com/sitemap.xml\n- https://example.com/about\n- https://example.com/pricing`,
    };
  }
  if (t.includes("robots") || t.includes("bot")) {
    return {
      title: "Allow AI crawlers in robots.txt",
      lang: "txt",
      placement: "Save as public/robots.txt",
      code: `User-agent: GPTBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nUser-agent: Applebot-Extended\nAllow: /\n\nSitemap: https://example.com/sitemap.xml`,
    };
  }
  if (t.includes("organization") || t.includes("json-ld") || t.includes("structured")) {
    return {
      title: "Add Organization JSON-LD",
      lang: "html",
      placement: "Drop in your <head> (root layout)",
      code: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Your Brand",\n  "url": "https://example.com",\n  "logo": "https://example.com/logo.png",\n  "sameAs": [\n    "https://x.com/yourbrand",\n    "https://www.linkedin.com/company/yourbrand"\n  ]\n}\n<\/script>`,
    };
  }
  if (t.includes("faq")) {
    return {
      title: "Add FAQPage JSON-LD",
      lang: "html",
      placement: "On pages with Q&A content",
      code: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [{\n    "@type": "Question",\n    "name": "What is Mellox AI?",\n    "acceptedAnswer": { "@type": "Answer", "text": "..." }\n  }]\n}\n<\/script>`,
    };
  }
  if (t.includes("sitemap")) {
    return {
      title: "Publish sitemap.xml",
      lang: "xml",
      placement: "Save as public/sitemap.xml",
      code: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc><priority>1.0</priority></url>\n  <url><loc>https://example.com/about</loc></url>\n  <url><loc>https://example.com/pricing</loc></url>\n</urlset>`,
    };
  }
  if (t.includes("canonical")) {
    return {
      title: "Add canonical link",
      lang: "html",
      placement: "Inside <head> of each page",
      code: `<link rel="canonical" href="https://example.com/current-page" />`,
    };
  }
  if (t.includes("description") || t.includes("meta")) {
    return {
      title: "Add meta description + Open Graph",
      lang: "html",
      placement: "Inside <head>",
      code: `<meta name="description" content="One concise sentence (≤155 chars) describing the page." />\n<meta property="og:title" content="Page title" />\n<meta property="og:description" content="Same sentence." />\n<meta property="og:image" content="https://example.com/og.jpg" />\n<meta name="twitter:card" content="summary_large_image" />`,
    };
  }
  if (t.includes("alt")) {
    return {
      title: "Add alt text to images",
      lang: "html",
      placement: "Every <img> tag",
      code: `<img src="/hero.jpg" alt="Describe what the image actually shows, not 'image'" />`,
    };
  }
  if (t.includes("h1") || t.includes("heading")) {
    return {
      title: "Use one descriptive H1 per page",
      lang: "html",
      placement: "Top of <main>",
      code: `<h1>Specific, keyword-rich page title</h1>\n<h2>Section heading</h2>\n<h3>Sub-section</h3>`,
    };
  }
  return null;
}

/* ─────────────── Fix drawer ─────────────── */
function FixDrawer({ action, onClose }: { action: ActionItem; onClose: () => void }) {
  const recipe = fixRecipe(action);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!recipe) return;
    try {
      await navigator.clipboard.writeText(recipe.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-2 rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 p-3">
        {recipe ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/95">
                <Wand2 className="h-3 w-3 text-[hsl(var(--brand-blue))]" strokeWidth={2.4} />
                {recipe.title}
              </div>
              <button
                onClick={onClose}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="mt-1 text-[10.5px] text-muted-foreground">{recipe.placement}</div>
            <div className="mt-2 relative">
              <pre className="max-h-48 overflow-auto rounded-lg border border-border/50 bg-background/80 p-2.5 text-[10.5px] leading-relaxed text-foreground/85">
                <code>{recipe.code}</code>
              </pre>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={copy}
                className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-1 text-[9.5px] font-medium text-foreground/80 hover:bg-secondary"
              >
                {copied ? (
                  <>
                    <Check className="h-2.5 w-2.5 text-emerald-500" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-2.5 w-2.5" /> Copy
                  </>
                )}
              </motion.button>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3" />
            <div>
              No prebuilt snippet for this one — apply the recommendation as described. The Mellox AI
              agent can draft a fix on request.
              <button
                onClick={onClose}
                className="ml-1 text-foreground/70 underline-offset-2 hover:underline"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const CACHE_KEY = (wsId: string) => `geo-audit:v1:${wsId}`;

export function GeoAeoPanel({ workspaceId }: { workspaceId: string | null }) {
  const { dna } = useBrandDna(workspaceId);
  const url = dna.websiteUrl;
  const [result, setResult] = useState<AuditResult | null>(null);
  const [open, setOpen] = useState<string | null>("ai-access");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState<string | null>(null);
  const savePersist = useServerFn(persistGeoAudit);

  useEffect(() => {
    if (!workspaceId) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY(workspaceId));
      if (raw) setResult(JSON.parse(raw));
    } catch {
      /* noop */
    }
  }, [workspaceId]);

  // Listen for chat-driven "run audit" requests so the panel responds when
  // the user asks Mellox AI to scan their site from chat.
  useEffect(() => {
    const onRun = () => {
      void run();
    };
    window.addEventListener("geo:run-audit", onRun);
    return () => window.removeEventListener("geo:run-audit", onRun);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, running]);

  const run = async () => {
    if (!url || running) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await authedFetch("/api/geo-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Audit failed (${res.status})`);
      }
      const json: AuditResult = await res.json();
      setResult(json);
      if (workspaceId) {
        try {
          localStorage.setItem(CACHE_KEY(workspaceId), JSON.stringify(json));
          localStorage.setItem(`geo:lastRun:${workspaceId}`, String(Date.now()));
        } catch {
          /* noop */
        }
      }
      try {
        window.dispatchEvent(new CustomEvent("geo:audit-complete"));
      } catch {
        /* noop */
      }
      if (workspaceId) {
        try {
          await savePersist({
            data: {
              workspaceId,
              url: json.url ?? url ?? null,
              score: Math.round(json.overall ?? 0),
              subscores: Object.fromEntries(
                (json.subscores ?? []).map((s) => [s.id, Math.round(s.score)]),
              ),
              meta: { actionsCount: (json.actions ?? []).length, fetchedAt: json.fetchedAt },
            },
          });
        } catch {
          /* persistence is best-effort */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setRunning(false);
    }
  };

  const lastScan = useMemo(() => {
    if (!result?.fetchedAt) return null;
    const diff = Date.now() - result.fetchedAt;
    const m = Math.round(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }, [result]);

  const verdict = result ? scoreVerdict(result.overall) : null;
  const verdictColor = result ? scoreColor(result.overall) : "";

  return (
    <section className="mt-6 px-1">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pb-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandStar
            mood={running ? "scanning" : result ? "excited" : "waving"}
            size={40}
            animate
          />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground/95 sm:text-[14px]">
              <span className="truncate">AI Search Visibility</span>
              <motion.span
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-green))]"
              />
            </div>
            <div className="truncate text-[11px] text-muted-foreground/80 sm:text-[12px]">
              {url ? (
                <>
                  How AI engines see{" "}
                  <span className="text-foreground/80">
                    {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </span>
                </>
              ) : (
                "Connect a website in Memory to begin"
              )}
              {lastScan && (
                <span className="ml-1.5 text-muted-foreground/60">· scanned {lastScan}</span>
              )}
            </div>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: url && !running ? 1.03 : 1 }}
          whileTap={{ scale: url && !running ? 0.97 : 1 }}
          onClick={run}
          disabled={!url || running}
          className={cn(
            "relative inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all sm:px-3.5 sm:text-[12px]",
            result
              ? "border border-border/70 bg-card hover:border-foreground/20 hover:bg-secondary"
              : "bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_4px_18px_-6px_hsl(var(--brand-blue)/0.6)]",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {running ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Scanning…
            </>
          ) : result ? (
            <>
              <RefreshCw className="h-3 w-3" /> Re-scan
            </>
          ) : (
            <>
              <Zap className="h-3 w-3" /> Run audit
            </>
          )}
          {!running && !result && (
            <motion.span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
              animate={{ x: ["-100%", "200%"] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.6 }}
            />
          )}
        </motion.button>
      </header>

      {/* ── Empty state ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!result && !running && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 px-4 py-4"
          >
            <motion.div
              aria-hidden
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  "radial-gradient(400px circle at 15% 0%, hsl(var(--brand-blue)/0.10), transparent 55%), radial-gradient(360px circle at 85% 100%, hsl(var(--brand-green)/0.10), transparent 55%)",
              }}
              animate={{ opacity: [0.25, 0.4, 0.25] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative flex items-center gap-3">
              <BrandStar mood="happy" size={44} animate />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-foreground/95">
                  {url
                    ? "See how ChatGPT, Gemini & Perplexity read your site"
                    : "Connect your website first"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  40+ checks · crawler access, schema, content shape and trust.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Loading skeleton ─────────────────────────────────── */}
        {running && !result && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <motion.div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/40 p-3.5">
              <motion.div
                aria-hidden
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--brand-blue)/0.18)] to-transparent"
                animate={{ x: ["-100%", "300%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
              />
              <div className="flex items-center gap-3">
                <BrandStar mood="scanning" size={64} animate />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-secondary/60" />
                  <div className="h-2.5 w-48 rounded bg-secondary/40" />
                  <div className="grid grid-cols-3 gap-1.5 pt-1 sm:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-10 rounded-lg bg-secondary/30" />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
            {Array.from({ length: 3 }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0.3 }}
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
                className="h-11 rounded-xl bg-secondary/40"
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {err && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[11.5px] text-rose-500"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          <span>{err}</span>
        </motion.div>
      )}

      {/* ── Result view ─────────────────────────── */}
      {result && verdict && (
        <>
          {/* Hero card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card to-card/30 p-4"
          >
            <motion.div
              aria-hidden
              className="absolute -right-12 -top-12 h-44 w-44 rounded-full blur-3xl"
              style={{ background: verdictColor, opacity: 0.18 }}
              animate={{ scale: [1, 1.15, 1], opacity: [0.12, 0.2, 0.12] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative flex flex-wrap items-center gap-3 sm:gap-4">
              <HeroScoreRing value={result.overall} />
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:text-[11px]">
                  GEO score · {result.subscores.length} signals
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span
                    className="text-[15px] font-semibold tracking-tight sm:text-[16px]"
                    style={{ color: verdictColor }}
                  >
                    {verdict.label}
                  </span>
                  <span className="text-[12px] text-muted-foreground sm:text-[12.5px]">
                    — {verdict.tone}
                  </span>
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground/80 sm:text-[11.5px]">
                  Auditing{" "}
                  <span className="font-medium text-foreground/80">
                    {result.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </span>
                </div>
              </div>
            </div>

            {/* Subscores */}
            <div className="relative mt-3 grid grid-cols-2 gap-1.5 min-[420px]:grid-cols-3 sm:grid-cols-6">
              {result.subscores.map((s, i) => (
                <SubscoreChip key={s.id} s={s} i={i} />
              ))}
            </div>
          </motion.div>

          {/* Priority actions */}
          {result.actions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="mt-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <motion.span
                    animate={{ rotate: [0, -8, 8, 0] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-amber-500/15"
                  >
                    <Lightbulb className="h-3 w-3 text-amber-500" strokeWidth={2.4} />
                  </motion.span>
                  <span className="text-[13px] font-semibold text-foreground/95 sm:text-[13.5px]">
                    Do this next
                  </span>
                </div>
                <span className="text-[10.5px] text-muted-foreground sm:text-[11px]">
                  Top {Math.min(5, result.actions.length)} of {result.actions.length}
                </span>
              </div>
              <ul className="space-y-1.5">
                {result.actions.slice(0, 5).map((a, i) => {
                  const isOpen = fixOpen === a.id;
                  return (
                    <motion.li
                      key={a.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 + i * 0.06, duration: 0.35 }}
                      className="rounded-xl border border-border/60 bg-card/60 transition-colors hover:border-foreground/20 hover:bg-card"
                    >
                      <div className="flex items-start gap-2 px-3 py-2.5 text-[12px] sm:gap-2.5 sm:text-[12.5px]">
                        <span
                          className={cn(
                            "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[9.5px] font-bold uppercase tracking-wider",
                            a.priority === "high" &&
                              "bg-rose-500/15 text-rose-500 ring-1 ring-rose-500/30",
                            a.priority === "med" &&
                              "bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/30",
                            a.priority === "low" &&
                              "bg-muted text-muted-foreground ring-1 ring-border/60",
                          )}
                        >
                          {a.priority === "high" ? "P0" : a.priority === "med" ? "P1" : "P2"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground/95 break-words">
                            {a.title}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground sm:text-[11.5px]">
                            {a.detail}
                          </div>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          onClick={() => setFixOpen(isOpen ? null : a.id)}
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold transition-all sm:text-[11px]",
                            isOpen
                              ? "border border-foreground/20 bg-secondary text-foreground"
                              : "bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] text-white shadow-[0_2px_10px_-3px_hsl(var(--brand-blue)/0.6)]",
                          )}
                        >
                          <Wrench className="h-2.5 w-2.5" strokeWidth={2.4} />
                          {isOpen ? "Hide" : "Fix"}
                        </motion.button>
                      </div>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <div className="px-3 pb-3">
                            <FixDrawer action={a} onClose={() => setFixOpen(null)} />
                          </div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </ul>
            </motion.div>
          )}

          {/* Section accordion */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="mt-4"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <ListTree className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.4} />
              <span className="text-[13px] font-semibold text-foreground/95 sm:text-[13.5px]">
                Full breakdown
              </span>
            </div>
            <div className="space-y-1.5">
              {result.sections.map((s, i) => {
                const meta = SECTION_META[s.id] ?? { icon: Info, hue: 0, short: s.title };
                const Icon = meta.icon;
                const isOpen = open === s.id;
                const sub = result.subscores.find((x) => x.id === s.id);
                const failing = s.checks.filter((c) => c.status === "fail").length;
                const warning = s.checks.filter((c) => c.status === "warn").length;
                const passing = s.checks.filter((c) => c.status === "pass").length;

                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6 + i * 0.04 }}
                    className={cn(
                      "overflow-hidden rounded-xl border bg-card/40 transition-colors",
                      isOpen ? "border-foreground/15" : "border-border/60",
                    )}
                  >
                    <button
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-border/60"
                        style={{
                          background: `linear-gradient(135deg, hsl(${meta.hue} 75% 58% / 0.24), hsl(${meta.hue} 75% 58% / 0.06))`,
                        }}
                      >
                        <Icon
                          className="h-3.5 w-3.5"
                          strokeWidth={2.2}
                          style={{ color: `hsl(${meta.hue} 70% 55%)` }}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-foreground/95 sm:text-[13.5px]">
                          {s.title}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground sm:text-[11.5px]">
                          {s.blurb}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <AnimatePresence>
                          {failing > 0 && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                              className="rounded-full bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-500"
                            >
                              {failing}
                            </motion.span>
                          )}
                          {warning > 0 && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                              className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-600"
                            >
                              {warning}
                            </motion.span>
                          )}
                          {failing === 0 && warning === 0 && passing > 0 && (
                            <motion.span
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                              className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-500"
                            >
                              ✓
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {sub && (
                          <span
                            className="tabular-nums font-semibold"
                            style={{ color: scoreColor(sub.score) }}
                          >
                            {sub.score}
                          </span>
                        )}
                        <motion.span
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={{ duration: 0.25 }}
                        >
                          <ChevronDown
                            className="h-3.5 w-3.5 text-muted-foreground"
                            strokeWidth={2}
                          />
                        </motion.span>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{
                            height: "auto",
                            opacity: 1,
                            transition: {
                              height: { duration: 0.36, ease: [0.22, 1, 0.36, 1] },
                              opacity: { duration: 0.28, delay: 0.08, ease: "easeOut" },
                            },
                          }}
                          exit={{
                            height: 0,
                            opacity: 0,
                            transition: {
                              height: { duration: 0.28, ease: [0.4, 0, 0.2, 1], delay: 0.04 },
                              opacity: { duration: 0.14, ease: "easeIn" },
                            },
                          }}
                          className="overflow-hidden"
                        >
                          <motion.ul
                            className="border-t border-border/40 divide-y divide-border/30"
                            initial="closed"
                            animate="open"
                            exit="closed"
                            variants={{
                              open: { transition: { staggerChildren: 0.035, delayChildren: 0.12 } },
                              closed: {
                                transition: { staggerChildren: 0.015, staggerDirection: -1 },
                              },
                            }}
                          >
                            {s.checks.map((c) => (
                              <motion.li
                                key={c.id}
                                variants={{
                                  open: {
                                    opacity: 1,
                                    y: 0,
                                    filter: "blur(0px)",
                                    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
                                  },
                                  closed: {
                                    opacity: 0,
                                    y: -6,
                                    filter: "blur(2px)",
                                    transition: { duration: 0.16, ease: "easeIn" },
                                  },
                                }}
                                className="flex items-start gap-2.5 px-3 py-2 text-[12px] transition-colors hover:bg-secondary/30 sm:text-[12.5px]"
                              >
                                <span className="mt-[3px]">
                                  <StatusGlyph status={c.status} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium text-foreground/90 break-words">
                                    {c.label}
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground sm:text-[11.5px]">
                                    {c.detail}
                                  </div>
                                </div>
                              </motion.li>
                            ))}
                          </motion.ul>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}

      {/* ── Connect CMS — only when user opens a Fix and hasn't connected yet ─────────────── */}
      <AnimatePresence>
        {fixOpen && (
          <motion.div
            key="connect-cms"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: 8, height: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card/70 to-card/20 p-3"
          >
            <div className="flex items-start gap-2.5">
              <motion.span
                animate={{ rotate: [0, 12, -12, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[hsl(var(--brand-blue)/0.2)] to-[hsl(var(--brand-green)/0.2)] ring-1 ring-border/60"
              >
                <Plug className="h-3.5 w-3.5 text-[hsl(var(--brand-blue))]" strokeWidth={2.2} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-foreground/95 sm:text-[13px]">
                  Deploy this fix automatically
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground sm:text-[11.5px]">
                  Connect your codebase or CMS and Mellox AI will open PRs / post drafts with the
                  recommended schema, llms.txt and meta fixes.
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
              <ConnectTile
                icon={<Github className="h-3.5 w-3.5" strokeWidth={2.2} />}
                label="GitHub"
                hint="Open pull requests"
                hue={220}
                disabled
              />
              <ConnectTile
                icon={<WordPressGlyph />}
                label="WordPress"
                hint="Push to posts & pages"
                hue={200}
                disabled
              />
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10.5px] text-muted-foreground/80 sm:text-[11px]">
              <Info className="h-3 w-3 shrink-0" />
              <span className="min-w-0">
                Connectors arrive in your Settings → Integrations soon.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ─────────────── Connect tile ─────────────── */
function ConnectTile({
  icon,
  label,
  hint,
  hue,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  hue: number;
  disabled?: boolean;
}) {
  return (
    <motion.button
      whileHover={{ y: disabled ? 0 : -2 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      disabled={disabled}
      className={cn(
        "group relative flex items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/60 px-2.5 py-2 text-left transition-all",
        disabled ? "opacity-80 cursor-not-allowed" : "hover:border-foreground/20 hover:bg-card",
      )}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-border/60"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 75% 58% / 0.22), hsl(${hue} 75% 58% / 0.05))`,
          color: `hsl(${hue} 70% 55%)`,
        }}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[12px] font-semibold text-foreground/95 sm:text-[12.5px]">
          <span className="truncate">{label}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-[1px] text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
            Soon
          </span>
        </div>
        <div className="truncate text-[10.5px] text-muted-foreground sm:text-[11px]">{hint}</div>
      </div>
      <ExternalLink
        className="h-3 w-3 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
        strokeWidth={2.2}
      />
    </motion.button>
  );
}

function WordPressGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM3.4 12c0-1.25.27-2.43.75-3.5l4.13 11.3A8.6 8.6 0 013.4 12zm8.6 8.6c-.84 0-1.65-.12-2.42-.35l2.6-7.55 2.66 7.29a8.5 8.5 0 01-2.84.61zm1.19-12.62c.52-.03.99-.08.99-.08.47-.06.41-.74-.05-.71 0 0-1.4.11-2.3.11-.85 0-2.27-.11-2.27-.11-.47-.03-.52.68-.06.71 0 0 .44.05.9.08l1.34 3.67-1.88 5.65L7.74 7.98c.52-.03.99-.08.99-.08.47-.06.41-.74-.05-.71 0 0-1.4.11-2.3.11-.16 0-.35 0-.55-.01A8.6 8.6 0 0112 3.4c2.27 0 4.34.88 5.88 2.31-.04 0-.07-.01-.11-.01-.85 0-1.45.74-1.45 1.54 0 .71.41 1.32.85 2.03.33.58.71 1.32.71 2.4 0 .74-.29 1.6-.66 2.81l-.87 2.9-3.16-9.4zm6.4 4.02c.45-1.13.6-2.03.6-2.83 0-.29-.02-.56-.05-.81a8.6 8.6 0 01-.99 8.42l2.61-7.55c.49 1.04.77 2.18.77 3.4 0 .77-.13 1.5-.36 2.18z" />
    </svg>
  );
}
