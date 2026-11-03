"use client";

/**
 * A connected app as its app icon, the same size and shape as
 * `PlatformAppIcon`, so a grid of social networks and business apps reads as
 * one set. Social networks use `PlatformAppIcon`; the business apps are drawn
 * here as simple marks on their brand's own tile.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CanvaMark } from "./CanvaMark";
import { isPlatformAppIconId, PlatformAppIcon } from "./PlatformAppIcon";

type Mark = { bg: string; glyph: (s: number) => ReactNode };

const svg = (s: number, children: ReactNode, box = "0 0 24 24") => (
  <svg viewBox={box} width={s} height={s} aria-hidden className="relative">
    {children}
  </svg>
);

const MARKS: Record<string, Mark> = {
  gmail: {
    bg: "#FFFFFF",
    glyph: (s) =>
      svg(
        s * 0.62,
        <>
          <path
            d="M2 6.5 12 13.5 22 6.5V18a1.5 1.5 0 0 1-1.5 1.5H18V10l-6 4.3L6 10v9.5H3.5A1.5 1.5 0 0 1 2 18Z"
            fill="#EA4335"
          />
          <path d="M2 6.5V18a1.5 1.5 0 0 0 1.5 1.5H6V10Z" fill="#4285F4" />
          <path d="M22 6.5V18a1.5 1.5 0 0 1-1.5 1.5H18V10Z" fill="#34A853" />
          <path d="M2 6.5 6 9.4V5.3l-1.6-1.2A1.5 1.5 0 0 0 2 5.3Z" fill="#C5221F" />
          <path d="M22 6.5 18 9.4V5.3l1.6-1.2A1.5 1.5 0 0 1 22 5.3Z" fill="#FBBC04" />
        </>,
      ),
  },
  googledrive: {
    bg: "#FFFFFF",
    glyph: (s) =>
      svg(
        s * 0.64,
        <>
          <path d="M8 3h8l7 12h-8Z" fill="#FBBC04" />
          <path d="M8 3 1 15l4 6 7-12Z" fill="#0F9D58" />
          <path d="M5 21h14l4-6H9Z" fill="#4285F4" />
        </>,
      ),
  },
  googlesheets: {
    bg: "#0F9D58",
    glyph: (s) =>
      svg(
        s * 0.56,
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" fill="#fff" />
          <path d="M7 9h10v8H7Z" fill="#0F9D58" />
          <path d="M7 12.5h10M7 15h10M11.5 9v8" stroke="#fff" strokeWidth="1.1" />
        </>,
      ),
  },
  googleads: {
    bg: "#FFFFFF",
    glyph: (s) =>
      svg(
        s * 0.62,
        <>
          <rect
            x="10"
            y="2.2"
            width="6"
            height="20"
            rx="3"
            transform="rotate(30 13 12)"
            fill="#4285F4"
          />
          <rect
            x="3.6"
            y="6.4"
            width="6"
            height="15"
            rx="3"
            transform="rotate(-30 6.6 14)"
            fill="#FBBC04"
          />
          <circle cx="5.2" cy="18.6" r="3" fill="#34A853" />
        </>,
      ),
  },
  hubspot: {
    bg: "#FF7A59",
    glyph: (s) =>
      svg(
        s * 0.6,
        <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="14" cy="14.5" r="4" />
          <path d="M14 10.5V6M14 6h-.01" />
          <circle cx="14" cy="4.6" r="1.6" fill="#fff" stroke="none" />
          <path d="M10.8 12.2 5 8" />
          <circle cx="4.2" cy="7.4" r="1.6" fill="#fff" stroke="none" />
          <path d="M11.3 17.3 8 20.5" />
        </g>,
      ),
  },
  mailchimp: {
    bg: "#FFE01B",
    glyph: (s) =>
      svg(
        s * 0.56,
        <path
          d="M5 18V7.5L12 14l7-6.5V18"
          fill="none"
          stroke="#241C15"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      ),
  },
};

export function hasAppLogo(id: string): boolean {
  return id === "canva" || id === "tiktok_ads" || id in MARKS || isPlatformAppIconId(id);
}

export function AppLogo({
  app,
  name,
  size = 40,
  className,
}: {
  /** Catalog app id (`gmail`, `instagram`, `canva`, ...). */
  app: string;
  /** Shown as a monogram when there is no mark. */
  name: string;
  size?: number;
  className?: string;
}) {
  if (isPlatformAppIconId(app))
    return <PlatformAppIcon platform={app} size={size} className={className} />;
  if (app === "tiktok_ads")
    return <PlatformAppIcon platform="tiktok" size={size} className={className} />;
  const mark = MARKS[app];
  const tile = cn(
    "relative inline-grid shrink-0 select-none place-items-center overflow-hidden",
    "ring-1 ring-inset ring-black/[0.06] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_rgb(0_0_0/0.25)]",
    className,
  );
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.26) };
  if (app === "canva")
    return (
      <span aria-hidden className={tile} style={{ ...style, background: "#FFFFFF" }}>
        <CanvaMark className="size-[72%]" />
      </span>
    );
  if (mark)
    return (
      <span aria-hidden className={tile} style={{ ...style, background: mark.bg }}>
        {mark.glyph(size)}
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(tile, "bg-[var(--ds-tile-bg)] font-semibold text-foreground")}
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
