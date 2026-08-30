import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  ScanLine,
  RefreshCw,
  ExternalLink,
  Wifi,
  Sparkles,
  Wand2,
  Brain,
  Cpu,
  Search,
  PenTool,
  Share2,
} from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import starEcho from "@/assets/stars/star-echo.png.asset.json";
import starScout from "@/assets/stars/star-atlas.png.asset.json";
import starSpark from "@/assets/stars/star-spark.png.asset.json";
import { usePreviewStage, setPreviewContext } from "@/lib/preview-stages";
import { PreviewStage } from "@/components/app/PreviewStage";

const STAR_AGENTS = [
  { name: "Scout", src: starScout.url, hue: 217, mood: "scanning your visibility" },
  { name: "Echo", src: starEcho.url, hue: 270, mood: "shaping the voice" },
  { name: "Spark", src: starSpark.url, hue: 40, mood: "lighting it up" },
] as const;

type WorkingState = {
  active: boolean;
  label: string;
  hue?: number;
};

/**
 * Website preview.
 *
 * Default mode: screenshot (reliable — most sites block iframe embedding via
 * X-Frame-Options / frame-ancestors CSP). The screenshot is captured live by
 * a public screenshot service, so it reflects the current state of the page.
 *
 * Optional mode: live iframe — user can opt in via the "Live" toggle. If the
 * site allows embedding the page will render interactively; if not the
 * browser shows a blank/error frame and the user can switch back.
 */
export function SitePreview({ workspaceId }: { workspaceId: string | null }) {
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [providerIdx, setProviderIdx] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [working, setWorking] = useState<WorkingState>({ active: false, label: "" });
  const stage = usePreviewStage();

  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setRawUrl(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("workspaces")
      .select("website_url")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRawUrl(data?.website_url ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const siteUrl = useMemo(() => {
    if (!rawUrl) return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }, [rawUrl]);

  // Ordered screenshot providers — fall through on error.
  const providers = useMemo(() => {
    if (!siteUrl) return [] as string[];
    const enc = encodeURIComponent(siteUrl);
    const bare = siteUrl.replace(/^https?:\/\//i, "");
    return [
      `https://api.microlink.io/?url=${enc}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1280&viewport.height=800&waitUntil=networkidle0`,
      `https://image.thum.io/get/width/1280/crop/800/noanimate/${siteUrl}`,
      `https://s.wordpress.com/mshots/v1/${enc}?w=1280&h=800`,
      `https://www.google.com/s2/favicons?domain=${bare}&sz=256`,
    ];
  }, [siteUrl]);

  const currentShot = providers[providerIdx];

  useEffect(() => {
    setLoaded(false);
    setErrored(false);
    setProviderIdx(0);
  }, [siteUrl, nonce]);

  // Publish live preview context so PreviewStage visuals can show the REAL
  // site screenshot (analyze scanner, browser frames, etc.) instead of mocks.
  useEffect(() => {
    setPreviewContext({
      siteUrl: siteUrl ?? null,
      screenshotUrl: loaded && !errored ? (currentShot ?? null) : null,
    });
  }, [siteUrl, currentShot, loaded, errored]);

  useEffect(() => {
    const onWorking = (e: Event) => {
      const detail = (e as CustomEvent<Partial<WorkingState>>).detail ?? {};
      setWorking({
        active: true,
        label: detail.label || "Agents working…",
        hue: detail.hue ?? 270,
      });
    };
    const onIdle = () => setWorking((w) => ({ ...w, active: false }));
    window.addEventListener("chat:working", onWorking as EventListener);
    window.addEventListener("chat:idle", onIdle);
    return () => {
      window.removeEventListener("chat:working", onWorking as EventListener);
      window.removeEventListener("chat:idle", onIdle);
    };
  }, []);

  const displayHost = siteUrl
    ? siteUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")
    : "no site connected";
  const accentHue = working.hue ?? 270;
  const accent = `hsl(${accentHue} 85% 60%)`;

  const handleImgError = () => {
    if (providerIdx < providers.length - 1) {
      setProviderIdx((i) => i + 1);
      setLoaded(false);
    } else {
      setErrored(true);
    }
  };

  const refresh = () => {
    setLoaded(false);
    setErrored(false);
    setProviderIdx(0);
    setNonce((n) => n + 1);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-8">
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-[11.5px] font-medium tracking-tight text-muted-foreground">
          <span className="relative inline-flex h-2 w-2 items-center justify-center">
            <span
              className={`h-2 w-2 rounded-full ${working.active ? "animate-pulse" : ""}`}
              style={
                working.active
                  ? { background: accent, boxShadow: `0 0 10px ${accent}` }
                  : loaded && siteUrl
                    ? {
                        background: "hsl(var(--brand-green))",
                        boxShadow: "0 0 10px hsl(var(--brand-green) / 0.7)",
                      }
                    : { background: "hsl(var(--muted-foreground) / 0.35)" }
              }
            />
          </span>
          <span className="text-foreground/75">
            {working.active
              ? working.label
              : loaded && siteUrl
                ? "Site snapshot"
                : errored
                  ? "Preview offline"
                  : "Site preview"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {siteUrl && (
            <>
              <IconButton title="Refresh preview" onClick={refresh}>
                <RefreshCw className={`h-3.5 w-3.5 ${working.active ? "animate-spin" : ""}`} />
              </IconButton>
              <IconButton
                as="a"
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <div className="relative">
        {loaded && siteUrl && !errored && (
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-4 -z-10 rounded-[2rem] opacity-70 blur-2xl"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 100%, hsl(var(--brand-green) / 0.18), transparent 70%), radial-gradient(50% 40% at 0% 0%, hsl(var(--brand-blue) / 0.10), transparent 70%)",
            }}
          />
        )}

        <motion.div
          ref={cardRef}
          layout
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="group relative overflow-hidden rounded-[1.75rem] bg-border/80 p-[1.5px] ring-1 ring-black/[0.03]"
          style={{
            aspectRatio: "16 / 10",
            boxShadow:
              "0 1px 2px hsl(0 0% 0% / 0.05), 0 12px 32px -16px hsl(0 0% 0% / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.6)",
          }}
        >
          <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[1.62rem] bg-card">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-50 rounded-[1.62rem] ring-1 ring-inset ring-border/70"
            />
            {/* Stage */}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.62rem] bg-secondary/30">
              {siteUrl ? (
                <>
                  {!errored && currentShot && (
                    <motion.img
                      key={`${currentShot}-${nonce}`}
                      src={`${currentShot}${currentShot.includes("?") ? "&" : "?"}_t=${nonce}`}
                      alt={`Preview of ${displayHost}`}
                      onLoad={() => setLoaded(true)}
                      onError={handleImgError}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: loaded ? 1 : 0 }}
                      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute inset-0 h-full w-full object-cover object-top"
                      draggable={false}
                    />
                  )}

                  <AnimatePresence>
                    {!loaded && !errored && (
                      <motion.div
                        key="skeleton"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 z-10 bg-secondary/40"
                      >
                        <motion.div
                          initial={{ x: "-100%" }}
                          animate={{ x: "100%" }}
                          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-y-0 w-1/2"
                          style={{
                            background:
                              "linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.05), transparent)",
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--brand-green))]" />
                            Capturing snapshot…
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {errored && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary ring-1 ring-border">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="text-[13px] font-semibold tracking-tight">
                        Preview unavailable
                      </div>
                      <p className="max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground">
                        Couldn't capture a snapshot. Try refreshing, switching to Live, or opening
                        the site directly.
                      </p>
                      <button
                        onClick={refresh}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11.5px] font-medium hover:bg-secondary"
                      >
                        <RefreshCw className="h-3 w-3" /> Try again
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState />
              )}

              <AnimatePresence>
                {stage ? (
                  <motion.div
                    key={`stage-${stage.kind}-${stage.index}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0 z-40 overflow-hidden rounded-[1.62rem] bg-background/92 backdrop-blur"
                  >
                    <PreviewStage stage={stage} />
                  </motion.div>
                ) : (
                  working.active && (
                    <motion.div
                      key="working"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="pointer-events-none absolute inset-0 z-40"
                    >
                      <WorkingOverlay accent={accent} label={working.label} />
                    </motion.div>
                  )
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  as,
  ...props
}: {
  children: React.ReactNode;
  as?: "a";
} & React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cls =
    "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground";
  if (as === "a") {
    return (
      <a className={cls} {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }
  return (
    <button className={cls} {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 p-6 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary ring-1 ring-border">
        <Globe className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-[13px] font-semibold tracking-tight text-foreground">
        No site connected
      </div>
      <p className="max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground">
        Connect a site during onboarding to see a live preview here.
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Agents working — interactive banner above the preview
 * ────────────────────────────────────────────────────────────────────────── */

const AGENT_ICONS = [
  { Icon: Search, label: "SEO", hue: 200 },
  { Icon: PenTool, label: "Content", hue: 280 },
  { Icon: Share2, label: "Social", hue: 20 },
  { Icon: Brain, label: "Strategy", hue: 320 },
  { Icon: Cpu, label: "Analytics", hue: 160 },
];

function AgentsWorkingBanner({ label, accent }: { label: string; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="mb-3 overflow-hidden"
    >
      <div
        className="relative overflow-hidden rounded-2xl border bg-card/80 px-4 py-3 backdrop-blur"
        style={{
          borderColor: `${accent}40`,
          boxShadow: `0 0 0 1px ${accent}15, 0 12px 32px -16px ${accent}55`,
        }}
      >
        {/* moving aurora wash */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background: `linear-gradient(110deg, transparent 0%, ${accent}22 35%, ${accent}55 50%, ${accent}22 65%, transparent 100%)`,
            backgroundSize: "220% 100%",
          }}
          animate={{ backgroundPosition: ["0% 0%", "100% 0%"] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "linear" }}
        />

        <div className="flex items-center gap-3">
          {/* Orbiting agent cluster */}
          <div className="relative h-10 w-10 shrink-0">
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${accent}66, transparent 70%)` }}
              animate={{ scale: [1, 1.25, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <div
              className="absolute inset-1 grid place-items-center rounded-full bg-background ring-1"
              style={{ borderColor: accent, boxShadow: `0 0 12px ${accent}88` }}
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              >
                <Wand2 className="h-3.5 w-3.5" style={{ color: accent }} />
              </motion.div>
            </div>
            {/* orbiting dots */}
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                style={{
                  marginLeft: -3,
                  marginTop: -3,
                  background: accent,
                  boxShadow: `0 0 6px ${accent}`,
                }}
                animate={{
                  rotate: [i * 120, i * 120 + 360],
                }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                // translate dot outwards via transform-origin trick
                initial={false}
              >
                <span
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ transform: "translate(18px, 0)" }}
                />
              </motion.span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold tracking-tight" style={{ color: accent }}>
                {label || "Agents working on your site"}
              </span>
              <TypingDots accent={accent} />
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {AGENT_ICONS.map(({ Icon, label: l }, i) => (
                <motion.div
                  key={l}
                  title={l}
                  className="grid h-5 w-5 place-items-center rounded-md bg-background/80 ring-1 ring-border"
                  animate={{
                    y: [0, -3, 0],
                    boxShadow: [
                      `0 0 0px ${accent}00`,
                      `0 0 10px ${accent}aa`,
                      `0 0 0px ${accent}00`,
                    ],
                  }}
                  transition={{
                    duration: 1.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.18,
                  }}
                >
                  <Icon className="h-3 w-3" style={{ color: accent }} />
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
            className="shrink-0"
          >
            <Sparkles className="h-4 w-4" style={{ color: accent }} />
          </motion.div>
        </div>

        {/* progress bar */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/60">
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
            animate={{ x: ["-40%", "140%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
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

function FeaturedStar({ src, index, hue }: { src: string; index: number; hue: number }) {
  // Each star takes the spotlight for a beat, then hands off to the next.
  const total = 4;
  const slot = 1.6; // seconds per star
  const cycle = total * slot;
  return (
    <motion.img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className="absolute h-14 w-14 select-none"
      style={{
        filter: `drop-shadow(0 0 10px hsl(${hue} 90% 60%)) drop-shadow(0 8px 16px hsl(${hue} 90% 50% / 0.5))`,
      }}
      animate={{
        opacity: [0, 1, 1, 0, 0],
        scale: [0.55, 1, 1, 0.55, 0.55],
        rotate: [-10, 0, 6, 10, -10],
      }}
      transition={{
        duration: cycle,
        times: [0, 0.08, 0.18, 0.25, 1],
        repeat: Infinity,
        delay: -index * slot,
        ease: "easeInOut",
      }}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Working overlay — sits on top of the preview while agents are running
 * ────────────────────────────────────────────────────────────────────────── */

function WorkingOverlay({ accent, label }: { accent: string; label: string }) {
  return (
    <>
      {/* frosted depth backdrop — soft veil so the preview reads as "paused / being cared for" */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        style={{
          background: `radial-gradient(120% 80% at 50% 50%, ${accent}10 0%, ${accent}22 45%, hsl(var(--background) / 0.55) 100%)`,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />

      {/* edge glow */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-[1.4rem]"
        style={{ boxShadow: `inset 0 0 0 2px ${accent}55, inset 0 0 40px ${accent}33` }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* vertical scanner */}
      <motion.div
        initial={{ y: "-20%" }}
        animate={{ y: "120%" }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-x-0 h-16"
        style={{
          background: `linear-gradient(to bottom, transparent, ${accent}55, transparent)`,
          filter: "blur(2px)",
        }}
      />
      {/* thin scan line */}
      <motion.div
        initial={{ y: "-10%" }}
        animate={{ y: "110%" }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-x-0 h-px"
        style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
      />

      {/* grid pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: `linear-gradient(${accent}55 1px, transparent 1px), linear-gradient(90deg, ${accent}55 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(circle at center, black 30%, transparent 75%)",
        }}
      />

      {/* corner brackets */}
      {(
        [
          ["top-3 left-3", "border-t-2 border-l-2"],
          ["top-3 right-3", "border-t-2 border-r-2"],
          ["bottom-3 left-3", "border-b-2 border-l-2"],
          ["bottom-3 right-3", "border-b-2 border-r-2"],
        ] as const
      ).map(([pos, side], i) => (
        <motion.span
          key={pos}
          className={`absolute ${pos} ${side} h-4 w-4 rounded-[3px]`}
          style={{ borderColor: accent }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}

      {/* emotional center stage — floating glass card with the AI crew orbiting it */}
      <div className="absolute inset-0 grid place-items-center" style={{ perspective: "900px" }}>
        {/* expanding pulse rings */}
        {[0, 1, 2].map((i) => (
          <motion.span
            key={`ring-${i}`}
            className="absolute h-20 w-20 rounded-full border-2"
            style={{ borderColor: accent }}
            animate={{ scale: [0.6, 2.4], opacity: [0.55, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
          />
        ))}

        {/* orbiting agent crew */}
        <motion.div
          className="absolute h-52 w-52"
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        >
          {STAR_AGENTS.map((star, i) => {
            const angle = (i / STAR_AGENTS.length) * Math.PI * 2;
            const r = 92;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            const hueAccent = `hsl(${star.hue} 90% 60%)`;
            return (
              <motion.div
                key={star.name}
                className="absolute"
                style={{
                  left: "50%",
                  top: "50%",
                  marginLeft: -22,
                  marginTop: -22,
                  transform: `translate(${x}px, ${y}px)`,
                }}
              >
                {/* counter-rotate so stars stay upright */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                  className="relative"
                >
                  {/* soft colored aura */}
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-full blur-xl"
                    style={{
                      background: `radial-gradient(circle, ${hueAccent}cc, transparent 70%)`,
                    }}
                    animate={{ opacity: [0.45, 0.95, 0.45], scale: [0.9, 1.15, 0.9] }}
                    transition={{
                      duration: 2.2,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                  <motion.img
                    src={star.src}
                    alt={`${star.name} agent`}
                    draggable={false}
                    className="h-12 w-12 select-none"
                    style={{
                      filter: `drop-shadow(0 0 6px ${hueAccent}) drop-shadow(0 6px 10px ${hueAccent}55)`,
                    }}
                    animate={{
                      y: [0, -4, 0, 3, 0],
                      rotate: [-6, 6, -6],
                    }}
                    transition={{
                      duration: 3.2,
                      repeat: Infinity,
                      delay: i * 0.25,
                      ease: "easeInOut",
                    }}
                  />
                  {/* tiny name tag */}
                  <span
                    className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-[1px] text-[8.5px] font-semibold tracking-tight backdrop-blur"
                    style={{
                      color: hueAccent,
                      background: "hsl(var(--background) / 0.85)",
                      border: `1px solid ${hueAccent}55`,
                    }}
                  >
                    {star.name}
                  </span>
                </motion.div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* trailing sparkle particles between stars */}
        {STAR_AGENTS.map((star, i) => (
          <motion.span
            key={`sparkle-${star.name}`}
            aria-hidden
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              background: `hsl(${star.hue} 90% 65%)`,
              boxShadow: `0 0 8px hsl(${star.hue} 90% 65%)`,
              left: "50%",
              top: "50%",
            }}
            animate={{
              x: [0, Math.cos((i / 4) * Math.PI * 2) * 60, 0],
              y: [0, Math.sin((i / 4) * Math.PI * 2) * 60, 0],
              opacity: [0, 1, 0],
              scale: [0.4, 1.2, 0.4],
            }}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
          />
        ))}

        {/* hero glass card — emotional copy */}
        <motion.div
          initial={{ opacity: 0, y: 12, rotateX: -8, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex flex-col items-center gap-2 rounded-2xl border bg-background/85 px-5 py-4 text-center shadow-2xl backdrop-blur-xl"
          style={{
            borderColor: `${accent}55`,
            boxShadow: `0 24px 60px -20px ${accent}88, 0 0 0 1px ${accent}33, inset 0 1px 0 hsl(0 0% 100% / 0.6)`,
            transformStyle: "preserve-3d",
          }}
        >
          <div className="relative grid h-14 w-14 place-items-center">
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full blur-lg"
              style={{ background: `radial-gradient(circle, ${accent}cc, transparent 70%)` }}
              animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            <AnimatePresence mode="wait">
              {STAR_AGENTS.map((star, i) => (
                <FeaturedStar key={star.name} src={star.src} index={i} hue={star.hue} />
              ))}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" style={{ color: accent }} />
            <span className="text-[12.5px] font-semibold tracking-tight" style={{ color: accent }}>
              {label || "Your AI team is on it"}
            </span>
            <TypingDots accent={accent} />
          </div>
          <p className="max-w-[220px] text-[10.5px] leading-relaxed text-muted-foreground">
            Sit back — we're crafting this with care. You'll see the update appear right here.
          </p>
        </motion.div>
      </div>

      {/* status pill */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1 text-[11px] font-semibold shadow-md backdrop-blur"
        style={{ borderColor: `${accent}55`, color: accent }}
      >
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <ScanLine className="h-3 w-3" />
        </motion.span>
        <span>{label || "Editing your site"}</span>
        <TypingDots accent={accent} />
      </motion.div>
    </>
  );
}
