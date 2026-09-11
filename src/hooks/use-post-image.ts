"use client";

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildImagePrompt,
  getCachedImage,
  setCachedImage,
  sizeForPlatform,
  deriveImageStyle,
  logoCorner,
  type BrandDnaLite,
  type ImgSize,
} from "@/lib/post-image";
import { compositeLogoOnImage } from "@/lib/composite-logo";
import type { PlatformId } from "@/lib/social-platforms";
import { deriveCreativeBrief } from "@/lib/creative-brief";
import { evaluateCreativePreflight, refinementInstructions } from "@/lib/creative-qa";
import { deriveCreativeStrategy } from "@/lib/creative-strategy";
import { persistGeneratedAsset } from "@/lib/persistent-assets";

export type ImageStatus = "idle" | "loading" | "success" | "error";

export function usePostImage(args: {
  postId?: string | null;
  workspaceId?: string | null;
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
    postId,
    workspaceId,
    postBody,
    postTitle,
    brand,
    workspaceName,
    platform,
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
  const generationKeyRef = useRef<string | null>(null);

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
    addAppEventListener("post-image:cached", onCached);
    return () => removeAppEventListener("post-image:cached", onCached);
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
    if (!body) {
      toast.error("No post text yet — write or generate the post first");
      return;
    }
    if (!workspaceId) {
      toast.error("Select a workspace before generating an image");
      return;
    }

    const generationSeed = postId ?? `${workspaceId}:${activeSize}`;

    const prompt = buildImagePrompt({
      postBody: body,
      postTitle,
      brand,
      workspaceName,
      platform,
      size: activeSize,
      seedKey: generationSeed,
      autoSize,
    });
    const brief = deriveCreativeBrief({
      body,
      audience: brand?.audience,
      platform,
      size: activeSize,
    });
    const strategy = deriveCreativeStrategy({ body, brief, brand, platform, size: activeSize });
    const preflight = evaluateCreativePreflight({
      strategy,
      prompt,
      size: activeSize,
      brandPresent: Boolean(brand),
      attempt: 1,
    });
    const refinedPrompt = [prompt, ...refinementInstructions(preflight)].join("\n\n");

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    generationKeyRef.current = crypto.randomUUID();
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
      const style = deriveImageStyle(brand?.voice, brand?.industry);
      await streamImage(
        refinedPrompt,
        (dataUrl, isFinal) => {
          setImage(dataUrl);
          if (isFinal) {
            void (async () => {
              try {
                if (!workspaceId) throw new Error("Workspace is required to persist this image");
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
                const persisted = (await persistGeneratedAsset({
                  workspaceId,
                  contentItemId: postId,
                  dataUrl: finalUrl,
                  idempotencyKey: generationKeyRef.current ?? `${generationSeed}:image`,
                  filename: `${postTitle || "mellox-post"}-${activeSize}.png`,
                  platform,
                  attempt: 1,
                  seed: generationSeed,
                  promptVersion: "2",
                  creativeBriefVersion: "1",
                  brandDnaVersion: brand ? "present" : "missing",
                  metadata: { source: "post-image", status: "ready" },
                })) as { public_url?: string };
                const permanentUrl = persisted.public_url || finalUrl;
                setImage(permanentUrl);
                setProgress(100);
                setStatus("success");
                if (timerRef.current) window.clearInterval(timerRef.current);
                if (postId) setCachedImage(postId, activeSize, permanentUrl);
                toast.success("Image ready", {
                  description: "Persisted to your Mellox Library.",
                });
                window.setTimeout(() => setStatus((s) => (s === "success" ? "idle" : s)), 1800);
              } catch (persistError) {
                if (timerRef.current) window.clearInterval(timerRef.current);
                const message =
                  persistError instanceof Error ? persistError.message : "Asset persistence failed";
                setError(message);
                setStatus("error");
                toast.error("Image generated but could not be saved", {
                  description: message,
                  duration: 8000,
                });
              }
            })();
          }
        },
        {
          signal: ctrl.signal,
          size: activeSize,
          style,
          routing: {
            taskType: "generation",
            brandPrecision: brand ? "strict" : "normal",
            requiredQuality: strategy.objective === "product-launch" ? "high" : "standard",
          },
          metadata: {
            creativeBriefVersion: "1",
            brandDnaVersion: brand ? "present" : "missing",
            promptVersion: "2",
            attempt: 1,
            seed: generationSeed,
          },
          maxAttempts: 3,
        },
      );
    } catch (e: any) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (e?.name === "AbortError") {
        setStatus("idle");
        setProgress(0);
        return;
      }
      const msg = e?.message ?? "Image generation failed";
      setError(msg);
      setStatus("error");
      toast.error("Image generation failed", { description: msg });
    }
  }, [
    status,
    postBody,
    postTitle,
    brand,
    workspaceName,
    platform,
    activeSize,
    postId,
    workspaceId,
    autoSize,
  ]);

  return { image, status, error, progress, size: activeSize, generate, cancel };
}
