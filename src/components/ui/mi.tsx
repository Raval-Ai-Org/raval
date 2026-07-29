import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * <Mi> — Material Symbols Rounded glyph (the icon family Google Gemini uses).
 *
 * The font is loaded globally via <link> in `src/routes/__root.tsx` and styled
 * by the `.mi` class in `src/styles.css`. Color follows `currentColor` so the
 * icon is automatically black in light mode and white in dark mode — matching
 * the Gemini treatment.
 *
 *   <Mi name="search" />
 *   <Mi name="settings" filled />
 *   <Mi name="auto_awesome" weight="medium" className="text-2xl" />
 *
 * Full icon list: https://fonts.google.com/icons?icon.set=Material+Symbols&icon.style=Rounded
 */
export interface MiProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  filled?: boolean;
  weight?: "light" | "regular" | "medium" | "bold";
  size?: number | string;
}

export const Mi = React.forwardRef<HTMLSpanElement, MiProps>(function Mi(
  { name, filled, weight, size, className, style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden={rest["aria-label"] ? undefined : true}
      data-filled={filled ? "true" : undefined}
      data-weight={weight}
      className={cn("mi", className)}
      style={size ? { fontSize: typeof size === "number" ? `${size}px` : size, ...style } : style}
      {...rest}
    >
      {name}
    </span>
  );
});
