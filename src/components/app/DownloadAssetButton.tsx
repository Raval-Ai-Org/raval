"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Spinner } from "@/components/icons";
import { cn } from "@/lib/utils";

function extensionFrom(url: string, mimeType?: string | null): string {
  const mimeExtension: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  if (mimeType && mimeExtension[mimeType.toLowerCase()])
    return mimeExtension[mimeType.toLowerCase()];
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1].toLowerCase() ?? "bin";
  } catch {
    return "bin";
  }
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "mellox-asset"
  );
}

export function DownloadAssetButton({
  url,
  filename,
  mimeType,
  className,
  compact = false,
  children,
}: {
  url?: string | null;
  filename: string;
  mimeType?: string | null;
  className?: string;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!url || busy) return;
    setBusy(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The asset could not be downloaded.");
      const blob = await response.blob();
      const extension = extensionFrom(url, mimeType || blob.type);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${safeFilename(filename)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      toast.error("Couldn't download asset", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void download();
      }}
      disabled={!url || busy}
      aria-label="Download"
      title="Download"
      className={cn(
        compact
          ? "grid size-8 place-items-center rounded-full text-foreground/85 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-3.5"
          : "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 [&_svg]:size-3.5",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
    >
      {busy ? <Spinner className="animate-spin" /> : <Download />}
      {!compact ? (children ?? "Download") : null}
    </button>
  );
}
