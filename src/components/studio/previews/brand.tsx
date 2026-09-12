"use client";

import { useMemo } from "react";
import { readBrandPayload } from "@/lib/studio/client";

export type PreviewBrand = {
  name: string;
  initial: string;
  logoUrl: string | null;
  /** Brand accent for designed surfaces (carousel slides); null = neutral. */
  color: string | null;
  font: string | null;
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function usePreviewBrand(workspaceId: string, fallbackName = "Your brand"): PreviewBrand {
  return useMemo(() => {
    const b = readBrandPayload(workspaceId) ?? {};
    const name = (typeof b.brandName === "string" && b.brandName.trim()) || fallbackName;
    const colors = Array.isArray(b.colors) ? (b.colors as { hex?: string }[]) : [];
    const color =
      colors.map((c) => c?.hex).find((h): h is string => typeof h === "string" && HEX.test(h)) ??
      null;
    const fonts = Array.isArray(b.fonts) ? (b.fonts as string[]) : [];
    return {
      name,
      initial: name.trim().charAt(0).toUpperCase() || "M",
      logoUrl: typeof b.logoUrl === "string" && /^https?:\/\//.test(b.logoUrl) ? b.logoUrl : null,
      color,
      font: fonts[0] ?? null,
    };
  }, [workspaceId, fallbackName]);
}

/** Readable ink (near-black or white) for text on a brand colour. */
export function inkOn(hex: string): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#111315" : "#ffffff";
}

export function BrandAvatar({ brand, size = 36 }: { brand: PreviewBrand; size?: number }) {
  return brand.logoUrl ? (
    <img
      src={brand.logoUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-surface-2 object-cover ring-1 ring-border"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-foreground/70 ring-1 ring-border"
      style={{ width: size, height: size }}
    >
      {brand.initial}
    </span>
  );
}
