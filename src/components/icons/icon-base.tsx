"use client";

/**
 * The Mellox icon primitive.
 *
 * Every glyph in this directory is a real inline `<svg>` drawn on a 24×24 grid
 * with its shapes inside a 20×20 optical box, so icons of different subjects
 * still look the same weight next to each other.
 *
 * Why not a font: the previous system rendered Material Symbols *ligatures*
 * into a `<span>` — literally the text "arrow_back" — which meant the raw
 * word painted before the remote font arrived, unknown names silently became
 * a dot, `strokeWidth` was discarded, and `h-3 w-3` and `h-4 w-4` collapsed to
 * the same 16px because sizing was resolved by parsing the className string.
 * Real SVGs fix all four: Tailwind's `h-*`/`w-*`/`size-*` classes size them
 * natively, and stroke weight is honoured.
 *
 * House style:
 *   • 1.75 stroke — light enough to feel modern, heavy enough at 14px
 *   • round caps and joins, so nothing has a sharp terminal
 *   • geometric construction with one radius family, matching --radius
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  /** Rendered px. A Tailwind `h-*`/`w-*`/`size-*` class overrides this. */
  size?: number | string;
  /** Defaults to 1.75. Small sizes get a touch more weight automatically. */
  strokeWidth?: number | string;
};

/** Matches the default in `styles.css` so CSS and JSX agree. */
export const ICON_STROKE = 1.75;
/** Below this, a 1.75 stroke starts to disappear. */
const SMALL_ICON_PX = 15;
const SMALL_ICON_STROKE = 2;
const DEFAULT_SIZE = 20;

export function resolveStroke(
  size: number | string | undefined,
  strokeWidth: IconProps["strokeWidth"],
) {
  if (strokeWidth !== undefined) return strokeWidth;
  const px = typeof size === "string" ? Number.parseFloat(size) : size;
  return typeof px === "number" && !Number.isNaN(px) && px <= SMALL_ICON_PX
    ? SMALL_ICON_STROKE
    : ICON_STROKE;
}

/**
 * Wraps a glyph's path data into a component.
 *
 * `solid` glyphs are filled rather than stroked — used where a shape reads
 * better as a mass (a status dot, a play triangle) than as an outline.
 */
export function createIcon(
  name: string,
  paths: React.ReactNode,
  options: { solid?: boolean; viewBox?: string } = {},
) {
  const Glyph = React.forwardRef<SVGSVGElement, IconProps>(function MelloxIcon(
    { className, size = DEFAULT_SIZE, strokeWidth, ...rest },
    ref,
  ) {
    const solid = options.solid ?? false;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={options.viewBox ?? "0 0 24 24"}
        width={size}
        height={size}
        fill={solid ? "currentColor" : "none"}
        stroke={solid ? "none" : "currentColor"}
        strokeWidth={solid ? undefined : resolveStroke(size, strokeWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
        // A decorative icon must not be announced. Passing an aria-label (or
        // role="img") opts back in, which is what an icon-only button needs.
        aria-hidden={rest["aria-label"] || rest.role ? undefined : true}
        focusable="false"
        data-icon={name}
        className={cn("shrink-0", className)}
        {...rest}
      >
        {paths}
      </svg>
    );
  });
  Glyph.displayName = `Icon(${name})`;
  return Glyph;
}

/** The shape every call site can rely on. Mirrors lucide's component type. */
export type MelloxIcon = ReturnType<typeof createIcon>;
