import { useEffect, useState, useCallback } from "react";
import type { CanvasType } from "@/lib/studio";

export type CanvasMode = "draft" | "review" | "view";

export type CanvasState = {
  type: CanvasType;
  id?: string;
  mode: CanvasMode;
} | null;

const STORAGE_LAST = "studio:last-canvas";

export function useStudioCanvas() {
  const [canvas, setCanvas] = useState<CanvasState>(null);

  const open = useCallback((type: CanvasType, opts?: { id?: string; mode?: CanvasMode }) => {
    setCanvas({ type, id: opts?.id, mode: opts?.mode ?? "draft" });
    try {
      localStorage.setItem(STORAGE_LAST, type);
    } catch {}
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("canvas", type);
      if (opts?.id) url.searchParams.set("artifact", opts.id);
      else url.searchParams.delete("artifact");
      window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
    }
  }, []);

  const close = useCallback(() => {
    setCanvas(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("canvas");
      url.searchParams.delete("artifact");
      const q = url.searchParams.toString();
      window.history.replaceState({}, "", url.pathname + (q ? "?" + q : ""));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const VALID: CanvasType[] = [
      "social-post",
      "seo-brief",
      "landing-page",
      "email",
      "article",
      "design-asset",
    ];
    const isValid = (t: unknown): t is CanvasType =>
      typeof t === "string" && (VALID as string[]).includes(t);
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const requested = detail?.type;
      const last = (() => {
        try {
          return localStorage.getItem(STORAGE_LAST) as CanvasType | null;
        } catch {
          return null;
        }
      })();
      // Ignore unknown canvas types instead of writing garbage into the URL.
      const target: CanvasType = isValid(requested)
        ? requested
        : isValid(last)
          ? last
          : "social-post";
      const id = typeof detail?.id === "string" ? detail.id : undefined;
      const mode =
        detail?.mode === "draft" || detail?.mode === "review" || detail?.mode === "view"
          ? detail.mode
          : undefined;
      open(target, { id, mode });
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        onOpen(new CustomEvent("open:canvas"));
      }
    };
    window.addEventListener("open:canvas", onOpen as EventListener);
    window.addEventListener("keydown", onKey);
    // Hydrate from URL on mount so `/app?canvas=<type>&artifact=<id>` opens
    // the canvas on a fresh load / refresh, matching the write path in open().
    try {
      const url = new URL(window.location.href);
      const type = url.searchParams.get("canvas");
      const id = url.searchParams.get("artifact") ?? undefined;
      if (isValid(type)) open(type, { id });
    } catch {
      /* noop */
    }

    return () => {
      window.removeEventListener("open:canvas", onOpen as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { canvas, open, close };
}
