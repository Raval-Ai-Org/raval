"use client";

/**
 * DEPRECATED — re-exports `@/components/icons`. Import from there instead.
 *
 * This barrel used to map each name onto the nearest available Material
 * Symbols glyph, which meant fifteen of its sixty exports pointed at the
 * wrong picture: `Palette` rendered the sparkles mark, `LayoutGrid` rendered a
 * folder, `Megaphone` a bell, `Wallet` a cloud, `Plug` a chain link, `Power` a
 * logout arrow, `History` a refresh arrow, and both `Crown` and `Gift`
 * rendered a star. Pointing the barrel at the real icon set corrects all of
 * them at once.
 *
 * Kept as a shim while the twelve importing files migrate.
 */

export * from "@/components/icons";
export type { IconProps, LucideIcon } from "@/components/icons";

import type { ComponentType } from "react";

/** Loose alias retained for call sites that annotate with it. */
export type BrandIcon = ComponentType<{
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
}>;
