"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

type PexelsVideo = {
  id: number;
  videoUrl: string;
  creatorName: string;
  creatorUrl: string;
  pexelsUrl: string;
  provider?: "Pexels" | "Raval AI";
  category?: string;
  query?: string;
  cachedAt?: string;
};

type UnsplashPhoto = {
  id: string;
  imageUrl: string;
  photographerName: string;
  photographerUrl: string;
  unsplashUrl: string;
};

const FLOWER_FALLBACK_VIDEO =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const MELLOX_ROTATION = [
  "AI",
  "Marketing",
  "Analytics",
  "Growth",
  "Automation",
  "Content",
  "Future",
];

function rotationDelay() {
  return 45_000 + Math.floor(Math.random() * 45_000);
}

async function fetchMelloxVideo(category: string): Promise<PexelsVideo | null> {
  const fallbackVideo: PexelsVideo = {
    id: 1,
    videoUrl: FLOWER_FALLBACK_VIDEO,
    creatorName: "MDN",
    creatorUrl: "https://developer.mozilla.org",
    pexelsUrl: "https://developer.mozilla.org/",
    provider: "Raval AI",
    category,
    query: category,
    cachedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(`/api/pexels/video?category=${encodeURIComponent(category)}`, {
      cache: "no-store",
    });
    if (!response.ok) return fallbackVideo;
    const result = (await response.json()) as Partial<PexelsVideo>;
    const hasPlayableVideo =
      Number.isFinite(result?.id) &&
      typeof result?.videoUrl === "string" &&
      /^https?:\/\//i.test(result.videoUrl);
    return hasPlayableVideo ? (result as PexelsVideo) : fallbackVideo;
  } catch {
    return fallbackVideo;
  }
}

function preloadVideo(videoUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const element = document.createElement("video");
    const finish = (ready: boolean) => {
      element.onloadedmetadata = null;
      element.onerror = null;
      resolve(ready);
    };
    element.preload = "metadata";
    element.muted = true;
    element.onloadedmetadata = () => finish(true);
    element.onerror = () => finish(false);
    element.src = videoUrl;
    element.load();
  });
}

/**
 * Minimal, animated auth shell.
 * Left: quiet brand canvas with a single drifting aurora.
 * Right: a focused, breathing card with the form.
 */
export function AuthShell({
  title,
  children,
  footer,
}: {
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  // useReducedMotion returns null on the server and a boolean on the client.
  // To avoid SSR/CSR hydration mismatches, we start as false (matching the
  // server render) and update after mount.
  const reduceMotionRaw = useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    setReduce(!!reduceMotionRaw);
  }, [reduceMotionRaw]);
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[hsl(var(--background))] text-foreground">
      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1440px] gap-0 p-3 sm:p-5 lg:grid-cols-2 lg:p-6">
        {/* Brand pane */}
        <aside className="relative hidden overflow-hidden rounded-[32px] lg:block">
          <BrandCanvas reduce={!!reduce} />
        </aside>

        {/* Form pane */}
        <section className="relative flex items-center justify-center px-3 py-7 sm:px-6 sm:py-10">
          <div className="w-full max-w-[360px]">
            <div className="mb-7 flex justify-center lg:hidden">
              <Logo height={30} />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease }}
            >
              <motion.h2
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6, ease }}
                className="font-display mb-7 text-center text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground"
              >
                {title}
              </motion.h2>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } },
                }}
                className="space-y-4"
              >
                {children}
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-7"
            >
              {footer}
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Stagger helper for form rows. */
export const authRow = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

function BrandCanvas({ reduce }: { reduce: boolean }) {
  const [video, setVideo] = useState<PexelsVideo | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [fallbackPhoto, setFallbackPhoto] = useState<UnsplashPhoto | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [categoryIndex, setCategoryIndex] = useState(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const updateDesktop = () => setIsDesktop(mediaQuery.matches);
    updateDesktop();
    mediaQuery.addEventListener("change", updateDesktop);
    return () => mediaQuery.removeEventListener("change", updateDesktop);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    async function loadVideo() {
      const result = await fetchMelloxVideo(MELLOX_ROTATION[0]);
      if (!cancelled && result) {
        setVideo(result);
        setFallbackPhoto(null);
      }
    }

    void loadVideo();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop || !video || video.provider !== "Pexels") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const nextIndex = (categoryIndex + 1) % MELLOX_ROTATION.length;
      const nextVideo = await fetchMelloxVideo(MELLOX_ROTATION[nextIndex]);
      if (!nextVideo || cancelled || !(await preloadVideo(nextVideo.videoUrl))) return;
      setCategoryIndex(nextIndex);
      setVideo(nextVideo);
    }, rotationDelay());

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [categoryIndex, isDesktop, video]);

  useEffect(() => {
    setVideoReady(false);
    setVideoFailed(false);
  }, [video?.id]);

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[32px] bg-black">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 90% at 0% 0%, #162536 0%, #0b111b 48%, #05070b 100%)",
        }}
      />
      {!reduce && (
        <>
          <motion.div
            aria-hidden
            className="absolute -left-24 top-12 h-[500px] w-[500px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(147,197,253,0.48) 0%, rgba(59,130,246,0.24) 28%, rgba(37,99,235,0) 72%)",
              filter: "blur(64px)",
            }}
            animate={{ x: [0, 55, -12, 0], y: [0, -26, 18, 0], scale: [1, 1.08, 0.96, 1] }}
            transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute -right-20 bottom-0 h-[580px] w-[580px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(125,211,252,0.36) 0%, rgba(14,116,144,0.2) 24%, rgba(14,116,144,0) 72%)",
              filter: "blur(72px)",
            }}
            animate={{ x: [0, -45, 20, 0], y: [0, 24, -18, 0], scale: [1, 0.94, 1.06, 1] }}
            transition={{ duration: 34, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 25%, rgba(147,197,253,0.08) 60%, rgba(255,255,255,0.04) 100%)",
            }}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}
      {video && !videoFailed && (
        <motion.video
          key={video.id}
          src={video.videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-[1.06] object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: videoReady ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.9, ease: "easeInOut" }}
          onCanPlay={() => setVideoReady(true)}
          onLoadedData={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            maxWidth: "none",
            objectFit: "cover",
            filter: "saturate(1.18) contrast(1.08) brightness(0.78)",
          }}
        />
      )}
      {fallbackPhoto && !video && (
        <motion.img
          src={fallbackPhoto.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 0.9, ease: "easeInOut" }}
        />
      )}
      <div aria-hidden className="absolute inset-0 bg-[hsl(var(--primary)/0.20)]" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,10,18,0.18) 0%, rgba(4,10,18,0.12) 25%, rgba(4,10,18,0.5) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 50%, #000 35%, transparent 85%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 80% at 50% 50%, transparent 52%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(circle at center, black 28%, transparent 100%)",
        }}
      />
    </div>
  );
}
