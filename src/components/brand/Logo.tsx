"use client";

import { memo } from "react";
import logoAsset from "@/assets/mellox-logo.svg.asset.json";

type LogoProps = {
  className?: string;
  /** Total height of the lockup in px. Mark scales with it. */
  height?: number;
  /** Hide the wordmark and show only the mark. */
  markOnly?: boolean;
};

/**
 * Mellox AI brand lockup using the canonical mark and brand typeface.
 */
function LogoBase({ className = "", height: heightProp = 18, markOnly = false }: LogoProps) {
  // Responsive scaling: base size fluidly interpolates between a mobile floor
  // and a desktop ceiling using clamp(), so the lockup stays proportional on
  // any viewport. `heightProp` sets the desktop target; the floor is 78% of it.
  const desktop = heightProp;
  const mobile = desktop * 0.78;
  // Fluid interpolation between 360px and 1280px viewport widths.
  const heightCss = `clamp(${mobile}px, ${mobile}px + (100vw - 360px) * ${(desktop - mobile) / (1280 - 360)}, ${desktop}px)`;
  const markCss = `calc(${heightCss} * 0.84)`;
  const textCss = `calc(${heightCss} * 0.7)`;
  const gapCss = `calc(${heightCss} * 0.32)`;

  return (
    <div
      className={`inline-flex items-center select-none ${className}`}
      style={{ height: heightCss, gap: gapCss }}
      aria-label="Mellox AI"
      role="img"
    >
      <img
        src={logoAsset.url}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="shrink-0"
        style={{ width: markCss, height: markCss, objectFit: "contain" }}
      />
      {!markOnly && (
        <span
          className="text-foreground leading-none"
          style={{
            fontFamily: "var(--font-brand)",
            fontSize: textCss,
            fontWeight: 400,
            letterSpacing: "0",
          }}
        >
          Mellox
          <span
            style={{
              marginLeft: "0.28em",
              fontWeight: 400,
              // Tie to --primary so both themes stay WCAG-AA against their surface.
              color: "hsl(var(--primary))",
              letterSpacing: "0",
            }}
          >
            AI
          </span>
        </span>
      )}
    </div>
  );
}

export const Logo = memo(LogoBase);
