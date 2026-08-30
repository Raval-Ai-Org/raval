import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Image as ImageIcon,
  Sparkles,
  X,
  AlertTriangle,
  Repeat as RefreshCw,
  Check,
} from "@/components/brand/icons";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePostImage } from "@/hooks/use-post-image";
import { loadBrandDna, hasAnyCachedImage, DEFAULT_IMG_SIZE, type ImgSize } from "@/lib/post-image";
import type { PlatformId } from "@/lib/social-platforms";
import { PromptInspector } from "@/components/app/PromptInspector";

// Module-level dedupe so multiple cards for the same post only hit the DB once,
// even when several rails mount them simultaneously.
const bodyCache = new Map<string, { body: string; channel?: string | null }>();
const inflight = new Map<string, Promise<{ body: string; channel?: string | null } | null>>();

function fetchPostBody(postId: string) {
  if (bodyCache.has(postId)) return Promise.resolve(bodyCache.get(postId)!);
  const existing = inflight.get(postId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { data } = await supabase
        .from("content_items")
        .select("body, channel")
        .eq("id", postId)
        .maybeSingle();
      const rec = data ? { body: String(data.body ?? ""), channel: data.channel ?? null } : null;
      if (rec) bodyCache.set(postId, rec);
      return rec;
    } catch {
      return null;
    } finally {
      inflight.delete(postId);
    }
  })();
  inflight.set(postId, p);
  return p;
}

/**
 * Compact "Generate image" button attached to any post (approval cards,
 * recent posts, etc.). Lazy-loads the post body from Supabase on click so
 * the surrounding lists stay cheap. Cache is shared with StudioCanvasModal
 * — the same (postId, size) is never billed twice.
 */
export function GeneratePostImageButton({
  postId,
  postTitle,
  platform,
  workspaceId,
  workspaceName,
  compact = true,
  className,
}: {
  postId: string;
  postTitle?: string | null;
  platform?: PlatformId | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string>("");
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [platformState, setPlatformState] = useState<PlatformId | null>(platform ?? null);
  // Instagram-first: every post image defaults to 1:1. User can override
  // via the size chips in the popover; the choice is remembered per session.
  const [size, setSize] = useState<ImgSize>(() => {
    if (typeof window === "undefined") return DEFAULT_IMG_SIZE;
    try {
      const saved = window.sessionStorage.getItem("post-image:size") as ImgSize | null;
      return saved === "1024x1024" || saved === "1792x1024" || saved === "1024x1792"
        ? saved
        : DEFAULT_IMG_SIZE;
    } catch {
      return DEFAULT_IMG_SIZE;
    }
  });
  const brand = loadBrandDna(workspaceId ?? null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { image, status, error, progress, generate, cancel } = usePostImage({
    postId,
    postBody: body,
    postTitle,
    brand,
    workspaceName,
    platform: platformState,
    autoSize: false,
    size,
  });

  const chooseSize = useCallback((s: ImgSize) => {
    setSize(s);
    try {
      window.sessionStorage.setItem("post-image:size", s);
    } catch {}
  }, []);

  // Show a subtle "has image" indicator when a cached image exists (any size)
  // for this post — cheap check, no fetch. Uses hasAnyCachedImage so the
  // badge lights up even when the cached size doesn't match the current
  // platform (e.g. modal cached 16:9, card is on Instagram/1:1).
  const [hasCached, setHasCached] = useState<boolean>(() => hasAnyCachedImage(postId));
  useEffect(() => {
    const on = () => setHasCached(hasAnyCachedImage(postId));
    on();
    window.addEventListener("post-image:cached", on);
    return () => window.removeEventListener("post-image:cached", on);
  }, [postId]);

  // Prime the post body + channel the moment the card scrolls into view.
  // Cache hydration is already synchronous via sessionStorage — this makes
  // the "Generate" button actionable the instant the popover opens, without
  // ever kicking off a generation on its own.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || bodyLoaded || !postId) return;
    if (typeof IntersectionObserver === "undefined") return;
    const conn = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (conn?.saveData || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.disconnect();
          void (async () => {
            const rec = await fetchPostBody(postId);
            if (rec?.body) setBody(rec.body);
            else setBody(postTitle || "");
            if (rec?.channel && !platformState) setPlatformState(String(rec.channel) as PlatformId);
            setBodyLoaded(true);
          })();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [postId, bodyLoaded, postTitle, platformState]);

  const openPopover = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpen((o) => !o);
      if (bodyLoaded || !postId) return;
      // Fallback for cards that never entered the observer (e.g. rendered
      // above the fold before mount) — still zero generation, just body prefetch.
      const rec = await fetchPostBody(postId);
      if (rec?.body) setBody(rec.body);
      else setBody(postTitle || "");
      if (rec?.channel && !platformState) setPlatformState(String(rec.channel) as PlatformId);
      setBodyLoaded(true);
    },
    [bodyLoaded, postId, postTitle, platformState],
  );

  const label = compact ? "Image" : "Generate image";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={openPopover}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium transition",
          hasCached
            ? "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300"
            : "text-foreground/80 hover:bg-muted",
        )}
        aria-label={hasCached ? "Image ready — open preview" : "Generate image"}
      >
        <ImageIcon className="h-3 w-3" strokeWidth={2.5} />
        {label}
        {hasCached && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full z-50 mt-1 w-[260px] overflow-hidden rounded-2xl border border-border/70 bg-popover p-2.5 shadow-2xl"
            >
              <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Post image
                </span>
                <div className="flex items-center gap-0.5">
                  {bodyLoaded && (
                    <PromptInspector
                      postBody={body}
                      postTitle={postTitle}
                      brand={brand}
                      workspaceName={workspaceName}
                      platform={platformState}
                      size={size}
                      seedKey={postId}
                      autoSize={false}
                      compact
                    />
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-md p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div
                className="relative overflow-hidden rounded-xl bg-muted/50"
                style={{ aspectRatio: aspectFor(size) }}
              >
                {image ? (
                  <img
                    src={image}
                    alt="Post"
                    className={cn("h-full w-full object-cover", status === "loading" && "blur-sm")}
                  />
                ) : status === "loading" ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
                    <Sparkles className="h-4 w-4 animate-pulse text-brand-green" />
                    <p className="text-[11px] text-muted-foreground">Rendering… {progress}%</p>
                  </div>
                ) : status === "error" ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <p className="text-[11px] leading-tight text-destructive">{error}</p>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                    {bodyLoaded ? "No image yet" : "Loading post…"}
                  </div>
                )}
                {status === "loading" && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
                    <div
                      className="h-full bg-brand-green transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Size chips — Instagram default, user-changeable. */}
              <div className="mt-2 flex items-center gap-1">
                {[
                  { s: "1024x1024" as ImgSize, label: "Instagram", sub: "1:1" },
                  { s: "1792x1024" as ImgSize, label: "Landscape", sub: "16:9" },
                  { s: "1024x1792" as ImgSize, label: "Story", sub: "9:16" },
                ].map((opt) => (
                  <button
                    key={opt.s}
                    onClick={() => chooseSize(opt.s)}
                    disabled={status === "loading"}
                    className={cn(
                      "flex-1 rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight transition disabled:opacity-40",
                      size === opt.s
                        ? "bg-foreground text-background"
                        : "bg-muted/60 text-foreground/70 hover:bg-muted",
                    )}
                    title={`${opt.label} · ${opt.sub}`}
                  >
                    <div>{opt.label}</div>
                    <div className="text-[9px] opacity-70">{opt.sub}</div>
                  </button>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-1.5">
                {status === "loading" ? (
                  <button
                    onClick={cancel}
                    className="flex-1 rounded-lg border border-border/60 px-2 py-1.5 text-[11.5px] font-medium text-foreground/80 hover:bg-muted"
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={generate}
                    disabled={!bodyLoaded || !body.trim()}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-foreground px-2 py-1.5 text-[11.5px] font-medium text-background transition hover:bg-foreground/90 disabled:opacity-40"
                  >
                    {image ? (
                      <>
                        <RefreshCw className="h-3 w-3" strokeWidth={2.5} /> Regenerate
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" strokeWidth={2.5} /> Generate
                      </>
                    )}
                  </button>
                )}
                {image && (
                  <a
                    href={image}
                    download={`${(postTitle || "post").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.${extensionForDataUrl(image)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-lg border border-border/60 px-2 py-1.5 text-[11.5px] font-medium text-foreground/80 hover:bg-muted"
                  >
                    Save
                  </a>
                )}
              </div>

              <p className="mt-1.5 px-1 text-[10.5px] leading-tight text-muted-foreground">
                {image
                  ? "Cached · switching platforms won't re-bill."
                  : "1 credit · personalized from Brand DNA + this post."}
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function aspectFor(size: ImgSize): string {
  if (size === "1792x1024") return "16 / 9";
  if (size === "1024x1792") return "9 / 16";
  return "1 / 1";
}

function extensionForDataUrl(dataUrl: string): "png" | "jpg" | "webp" {
  if (dataUrl.startsWith("data:image/jpeg")) return "jpg";
  if (dataUrl.startsWith("data:image/webp")) return "webp";
  return "png";
}
