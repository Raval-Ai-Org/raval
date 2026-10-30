"use client";

/**
 * A platform as its phone app icon: the real mark, white on the brand's own
 * tile (Instagram's gradient, Facebook blue, TikTok black with its cyan/red
 * edge). Used wherever a person picks or recognises a channel, so they find it
 * by its logo instead of reading a row of names.
 *
 * Glyphs come from `BrandLogo`; only the tiles and the few marks whose app icon
 * differs from the logo (Facebook's bleeding "f", LinkedIn's "in", TikTok's
 * three-layer note) are drawn here.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { BrandLogo, BRAND_LABEL, type BrandKey } from "./BrandLogo";

/** Platform ids used across the app (`twitter` is X). */
export type PlatformAppIconId = BrandKey | "twitter";

/**
 * Instagram's 2022 gradient: yellow in the bottom-left corner through orange
 * and magenta to violet top-right (not the older peach-to-blue radial).
 */
const INSTAGRAM_TILE =
  "radial-gradient(120% 120% at 0% 100%, #FFD600 0%, #FF7A00 26%, #FF0069 52%, #D300C5 74%, #7638FA 100%)";

/**
 * Tile background, glyph colour and glow per mark. White tiles keep the logo
 * in colour. `glow` is the brand colour a picked icon gives off.
 */
const TILES: Record<
  BrandKey,
  { bg: string; glyph: "white" | "brand"; scale?: number; glow: string }
> = {
  instagram: { bg: INSTAGRAM_TILE, glyph: "white", glow: "#FF0069" },
  // Facebook's 2023 brand blue.
  facebook: { bg: "#0866FF", glyph: "white", glow: "#0866FF" },
  linkedin: { bg: "#0A66C2", glyph: "white", glow: "#0A66C2" },
  x: { bg: "#000000", glyph: "white", scale: 0.48, glow: "#71767B" },
  threads: { bg: "#000000", glyph: "white", scale: 0.54, glow: "#71767B" },
  tiktok: { bg: "#000000", glyph: "white", glow: "#FE2C55" },
  youtube: { bg: "#FFFFFF", glyph: "brand", scale: 0.66, glow: "#FF0033" },
  pinterest: { bg: "#FFFFFF", glyph: "brand", scale: 0.68, glow: "#E60023" },
  reddit: { bg: "#FF4500", glyph: "white", scale: 0.66, glow: "#FF4500" },
  quora: { bg: "#B92B27", glyph: "white", scale: 0.56, glow: "#B92B27" },
  meta: { bg: "#FFFFFF", glyph: "brand", scale: 0.68, glow: "#0081FB" },
  google: { bg: "#FFFFFF", glyph: "brand", scale: 0.56, glow: "#4285F4" },
  openai: { bg: "#000000", glyph: "white", scale: 0.58, glow: "#71767B" },
  claude: { bg: "#D97757", glyph: "white", scale: 0.58, glow: "#D97757" },
  gemini: { bg: "#FFFFFF", glyph: "brand", scale: 0.62, glow: "#4E82EE" },
};

/** The colour a picked icon glows in. */
export function platformGlow(id: PlatformAppIconId): string {
  return TILES[platformBrandKey(id)].glow;
}

/** For ids that arrive as plain strings (stored rows, onboarding briefs). */
export function isPlatformAppIconId(id: string): id is PlatformAppIconId {
  return id === "twitter" || id in TILES;
}

export function platformBrandKey(id: PlatformAppIconId): BrandKey {
  return id === "twitter" ? "x" : id;
}

/** The plain name, for `aria-label` / `title` where the icon stands alone. */
export function platformAppIconLabel(id: PlatformAppIconId): string {
  return BRAND_LABEL[platformBrandKey(id)];
}

/** Facebook's app icon: a white "f" that runs off the bottom of the tile. */
const FACEBOOK_F =
  "M10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.682 4.533-4.682 1.312 0 2.686.235 2.686.235v2.965h-1.514c-1.491 0-1.956.93-1.956 1.884v2.262h3.328l-.532 3.49h-2.796V24z";

/** LinkedIn's app icon: the "in" alone, without the rounded square. */
const LINKEDIN_IN =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z";

const TIKTOK_NOTE =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

function Glyph({ name, size }: { name: BrandKey; size: number }) {
  const tile = TILES[name];
  if (name === "facebook") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="absolute inset-0">
        <path d={FACEBOOK_F} fill="#fff" transform="translate(1.6 0.4) scale(0.92)" />
      </svg>
    );
  }
  if (name === "linkedin") {
    // Cropped to the letters so "in" fills the tile the way the app icon does.
    const g = Math.round(size * 0.52);
    return (
      <svg viewBox="3.27 3.3 17.18 17.18" width={g} height={g} aria-hidden className="relative">
        <path d={LINKEDIN_IN} fill="#fff" />
      </svg>
    );
  }
  if (name === "instagram") {
    // The 2022 glyph: a bolder rounded square, lens and flash, drawn as strokes
    // so the weight stays even at every size.
    const g = Math.round(size * 0.64);
    return (
      <svg
        viewBox="0 0 24 24"
        width={g}
        height={g}
        aria-hidden
        className="relative"
        fill="none"
        stroke="#fff"
        strokeWidth={2.15}
      >
        <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.6" />
        <circle cx="12" cy="12" r="4.35" />
        <circle cx="17.45" cy="6.55" r="1.3" fill="#fff" stroke="none" />
      </svg>
    );
  }
  if (name === "tiktok") {
    const g = Math.round(size * 0.6);
    return (
      <svg viewBox="0 0 24 24" width={g} height={g} aria-hidden className="relative">
        <path d={TIKTOK_NOTE} fill="#25F4EE" transform="translate(-0.7 -0.7)" />
        <path d={TIKTOK_NOTE} fill="#FE2C55" transform="translate(0.7 0.7)" />
        <path d={TIKTOK_NOTE} fill="#fff" />
      </svg>
    );
  }
  const g = Math.round(size * (tile.scale ?? 0.58));
  return (
    <span className="relative grid place-items-center" style={{ color: "#fff" }}>
      <BrandLogo name={name} brand={tile.glyph === "brand"} size={g} />
    </span>
  );
}

export function PlatformAppIcon({
  platform,
  size = 40,
  className,
  style,
  label,
}: {
  platform: PlatformAppIconId;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Give the icon a name for screen readers when it stands alone. */
  label?: boolean;
}) {
  const name = platformBrandKey(platform);
  const tile = TILES[name];
  const dark = tile.bg === "#000000";
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ? BRAND_LABEL[name] : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative inline-grid shrink-0 select-none place-items-center overflow-hidden",
        // A hairline keeps black tiles visible on the dark canvas and white
        // ones on the light canvas; the soft drop shadow lifts it like an app icon.
        dark ? "ring-1 ring-inset ring-white/15" : "ring-1 ring-inset ring-black/[0.06]",
        "shadow-[0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-4px_rgb(0_0_0/0.25)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        background: tile.bg,
        ...style,
      }}
    >
      <Glyph name={name} size={size} />
      {/* A barely-there top light: official icons are flat, this only gives depth. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.07] via-transparent to-black/[0.04]"
      />
    </span>
  );
}
