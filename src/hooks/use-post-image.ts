import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildImagePrompt,
  getCachedImage,
  setCachedImage,
  sizeForPlatform,
  deriveRecraftStyle,
  logoCorner,
  type BrandDnaLite,
  type ImgSize,
} from "@/lib/post-image";
import { compositeLogoOnImage } from "@/lib/composite-logo";
import type { PlatformId } from "@/lib/social-platforms";

export type ImageStatus = "idle" | "loading" | "success" | "error";

export function usePostImage(args: {
  postId?: string | null;
  postBody: string;
  postTitle?: string | null;
  brand: BrandDnaLite | null;
  workspaceName?: string | null;
  platform?: PlatformId | null;
  /** When true, size follows the platform automatically.
   *  Default false → Instagram-first (1:1) unless user opts in. */
  autoSize?: boolean;
  /** Explicit size when autoSize=false. Defaults to Instagram 1:1. */
  size?: ImgSize;
}) {
  const {
    postId, postBody, postTitle, brand, workspaceName, platform,
    autoSize = false,
    size: explicitSize,
  } = args;

  const activeSize: ImgSize = autoSize ? sizeForPlatform(platform) : (explicitSize ?? "1024x1024");


  const [image, setImage] = useState<string | null>(() => getCachedImage(postId, activeSize));
  const [status, setStatus] = useState<ImageStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  // Rehydrate on postId/size change; also react to cache events fired by
  // other components (so a modal-generated image appears on the approval card).
  useEffect(() => {
    setImage(getCachedImage(postId, activeSize));
    setStatus("idle");
    setError(null);
    setProgress(0);
    const onCached = (e: Event) => {
      const d = (e as CustomEvent).detail as { postId?: string; size?: ImgSize } | undefined;
      if (d?.postId && d.postId === postId) {
        setImage(getCachedImage(postId, activeSize));
      }
    };
    window.addEventListener("post-image:cached", onCached as EventListener);
    return () => window.removeEventListener("post-image:cached", onCached as EventListener);
  }, [postId, activeSize]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) window.clearInterval(timerRef.current);
    setStatus("idle");
    setProgress(0);
  }, []);

  const generate = useCallback(async () => {
    if (status === "loading") return;
    const body = (postBody || "").trim();
    if (!body) { toast.error("No post text yet — write or generate the post first"); return; }
    if (!postId) { toast.error("Save the draft first, then generate an image"); return; }

    const prompt = buildImagePrompt({
      postBody: body, postTitle, brand, workspaceName,
      platform, size: activeSize, seedKey: postId, autoSize,
    });

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    setError(null);
    setProgress(6);
    setImage(null);

    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setProgress((p) => (p < 92 ? p + Math.max(1, Math.round((94 - p) * 0.06)) : p));
    }, 220) as unknown as number;

    try {
      const { streamImage } = await import("@/lib/streamImage");
      const style = deriveRecraftStyle(brand?.voice, brand?.industry);
      await streamImage(prompt, (dataUrl, isFinal) => {
        setImage(dataUrl);
        if (isFinal) {
          void (async () => {
            let finalUrl = dataUrl;
            if (brand?.logoUrl) {
              const corner = logoCorner(activeSize) === "top-left" ? "tl" : "br";
              finalUrl = await compositeLogoOnImage(dataUrl, {
                logoUrl: brand.logoUrl,
                size: activeSize,
                corner,
                widthPct: 0.12,
                insetPct: 0.04,
              });
              setImage(finalUrl);
            }
            setProgress(100);
            setStatus("success");
            if (timerRef.current) window.clearInterval(timerRef.current);
            setCachedImage(postId, activeSize, finalUrl);
            toast.success("Image ready", { description: brand?.logoUrl ? "Brand logo composited · cached for this post." : "1 credit used · cached for this post." });
            window.setTimeout(() => setStatus((s) => (s === "success" ? "idle" : s)), 1800);
          })();
        }
      }, { signal: ctrl.signal, size: activeSize, style });
    } catch (e: any) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (e?.name === "AbortError") { setStatus("idle"); setProgress(0); return; }
      const msg = e?.message ?? "Image generation failed";
      setError(msg);
      setStatus("error");
      toast.error("Image generation failed", { description: msg });
    }
  }, [status, postBody, postTitle, brand, workspaceName, platform, activeSize, postId, autoSize]);

  return { image, status, error, progress, size: activeSize, generate, cancel };
}
