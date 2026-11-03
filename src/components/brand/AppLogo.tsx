"use client";

/**
 * A connected app as its app icon, the same size and shape as
 * `PlatformAppIcon`, so a grid of social networks and business apps reads as
 * one set. Social networks use `PlatformAppIcon`; every other app is its
 * official mark on a white tile (the way app directories show them).
 *
 * Marks follow each company's published logo: Google's product icons, Simple
 * Icons (CC0) for single-colour marks, and the logo files in /public/logos.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CanvaMark } from "./CanvaMark";
import { isPlatformAppIconId, PlatformAppIcon } from "./PlatformAppIcon";
import { SiteLogo } from "./SiteLogos";

type Mark = { scale: number; draw: (s: number) => ReactNode };

const svg = (s: number, box: string, children: ReactNode) => (
  <svg viewBox={box} width={s} height={s} aria-hidden className="relative">
    {children}
  </svg>
);

const img = (src: string) => (s: number) => (
  // Local brand files; the tile gives them their shape.
  <img
    src={src}
    alt=""
    width={s}
    height={s}
    className="relative object-contain"
    draggable={false}
  />
);

const MARKS: Record<string, Mark> = {
  // Gmail (2020 icon).
  gmail: {
    scale: 0.62,
    draw: (s) =>
      svg(
        s,
        "52 42 88 66",
        <>
          <path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
          <path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
          <path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
          <path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
          <path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
        </>,
      ),
  },
  // Google Drive (2020 icon).
  googledrive: {
    scale: 0.62,
    draw: (s) =>
      svg(
        s,
        "0 0 87.3 78",
        <>
          <path
            fill="#0066DA"
            d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
          />
          <path
            fill="#00AC47"
            d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z"
          />
          <path
            fill="#EA4335"
            d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
          />
          <path
            fill="#00832D"
            d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
          />
          <path
            fill="#2684FC"
            d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
          />
          <path
            fill="#FFBA00"
            d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
          />
        </>,
      ),
  },
  // Google Sheets: the green sheet with its folded corner and table.
  googlesheets: {
    scale: 0.6,
    draw: (s) =>
      svg(
        s,
        "-9 0 66 66",
        <>
          <path
            fill="#0F9D58"
            d="M29 0H4.5A4.5 4.5 0 0 0 0 4.5v57A4.5 4.5 0 0 0 4.5 66h39a4.5 4.5 0 0 0 4.5-4.5V19Z"
          />
          <path fill="#263238" fillOpacity=".12" d="M30.3 17.7 48 35.4V19Z" />
          <path fill="#87CEAC" d="M29 0v14.5a4.5 4.5 0 0 0 4.5 4.5H48Z" />
          <path
            fill="#F1F1F1"
            d="M11 31h26v20H11Zm2.6 2.6v3.6h8.2v-3.6Zm10.8 0v3.6h10v-3.6Zm-10.8 6.2v3.6h8.2v-3.6Zm10.8 0v3.6h10v-3.6Zm-10.8 6.2v2.4h8.2V46Zm10.8 0v2.4h10V46Z"
          />
        </>,
      ),
  },
  // Google Ads: yellow and blue bars meeting at the top, green dot.
  googleads: {
    scale: 0.66,
    draw: (s) =>
      svg(
        s,
        "0 0 24 24",
        <g strokeLinecap="round" strokeWidth="6">
          <path d="M12 5.4 5.4 16.8" stroke="#FBBC04" />
          <path d="M12 5.4l6.6 11.4" stroke="#4285F4" />
          <circle cx="5.4" cy="16.8" r="3" fill="#34A853" stroke="none" />
        </g>,
      ),
  },
  // Google Analytics.
  google: {
    scale: 0.6,
    draw: (s) =>
      svg(
        s,
        "0 0 192 192",
        <>
          <path
            fill="#F9AB00"
            d="M130 29v132c0 14.77 10.19 23 21 23 10 0 21-7 21-23V30c0-13.54-10-22-21-22s-21 9.33-21 21z"
          />
          <path
            fill="#E37400"
            d="M75 96v65c0 14.77 10.19 23 21 23 10 0 21-7 21-23V97c0-13.54-10-22-21-22s-21 9.33-21 21z"
          />
          <circle cx="41" cy="163" r="21" fill="#E37400" />
        </>,
      ),
  },
  // HubSpot sprocket (Simple Icons).
  hubspot: {
    scale: 0.62,
    draw: (s) =>
      svg(
        s,
        "0 0 24 24",
        <path
          fill="#FF7A59"
          d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.193v.067a2.196 2.196 0 0 0 1.252 1.973l.013.006v2.852a6.22 6.22 0 0 0-2.969 1.31l.012-.009-7.828-6.096a2.497 2.497 0 1 0-1.157 1.515l-.012.006 7.696 5.991a6.176 6.176 0 0 0-1.038 3.446c0 1.343.425 2.588 1.15 3.6l-.013-.019-2.342 2.342a1.968 1.968 0 0 0-.58-.095h-.002a2.033 2.033 0 1 0 2.033 2.033 1.978 1.978 0 0 0-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 1 0 4.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 1 1 3.215-3.207v.002a3.206 3.206 0 0 1-3.207 3.207z"
        />,
      ),
  },
  notion: { scale: 0.7, draw: img("/logos/notion.webp") },
  slack: { scale: 0.62, draw: img("/logos/slack.webp") },
  canva: { scale: 0.72, draw: () => <CanvaMark className="relative size-full" /> },
  github: {
    scale: 0.6,
    draw: (s) => <SiteLogo provider="github" size={s} className="relative text-[#181717]" />,
  },
  wordpress: {
    scale: 0.62,
    draw: (s) => <SiteLogo provider="wordpress" size={s} brand className="relative" />,
  },
  webflow: {
    scale: 0.62,
    draw: (s) => <SiteLogo provider="webflow" size={s} brand className="relative" />,
  },
  wix: {
    scale: 0.7,
    draw: (s) => <SiteLogo provider="wix" size={s} className="relative text-black" />,
  },
};

/** Mailchimp's yellow is its tile; the rest sit on white. */
const TILE_BG: Record<string, string> = { mailchimp: "#FFE01B" };

const MAILCHIMP: Mark = {
  scale: 0.6,
  draw: (s) =>
    svg(
      s,
      "0 0 24 24",
      <path
        d="M5 18V7.5L12 14l7-6.5V18"
        fill="none"
        stroke="#241C15"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
    ),
};

export function hasAppLogo(id: string): boolean {
  return id === "tiktok_ads" || id === "mailchimp" || id in MARKS || isPlatformAppIconId(id);
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
  const mark = app === "mailchimp" ? MAILCHIMP : MARKS[app];
  const tile = cn(
    "relative inline-grid shrink-0 select-none place-items-center overflow-hidden",
    "ring-1 ring-inset ring-black/[0.06] shadow-[0_1px_2px_rgb(0_0_0/0.10),0_6px_16px_-6px_rgb(0_0_0/0.22)]",
    className,
  );
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.26) };
  if (mark) {
    const inner = Math.round(size * mark.scale);
    return (
      <span
        aria-hidden
        className={tile}
        style={{ ...style, background: TILE_BG[app] ?? "#FFFFFF" }}
      >
        <span className="grid place-items-center" style={{ width: inner, height: inner }}>
          {mark.draw(inner)}
        </span>
      </span>
    );
  }
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
