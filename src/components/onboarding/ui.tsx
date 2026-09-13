"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "@/components/icons";

/**
 * The quiet ground behind onboarding: one brand-tinted pool and a masked dot
 * grid, drawn from tokens. Static — nothing to animate, nothing to download.
 */
export function AmbientCanvas() {
  const mask = "radial-gradient(ellipse 80% 60% at 50% 0%, #000 15%, transparent 72%)";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-[560px]"
        style={{
          background:
            "radial-gradient(55% 100% at 50% 0%, hsl(var(--brand) / 0.13) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(hsl(var(--foreground) / 0.07) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    </div>
  );
}

export function Eyebrow({
  icon: Icon,
  children,
  className = "",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground ${className}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />}
      {children}
    </p>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[12px] leading-none text-foreground/80">
      {children}
    </li>
  );
}

/**
 * A brand's mark: tries each image source in order and falls back to a
 * monogram, so a blocked or broken logo never leaves an empty box.
 */
export function BrandMark({
  sources,
  name,
  size = 48,
  className = "",
}: {
  sources: (string | null | undefined)[];
  name: string;
  size?: number;
  className?: string;
}) {
  const candidates = sources.filter((src): src is string => !!src);
  const key = candidates.join("|");
  const [failures, setFailures] = useState({ key, count: 0 });
  const failed = failures.key === key ? failures.count : 0;
  const src = candidates[failed];
  const initial = (name.trim()[0] || "?").toUpperCase();

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[28%] border border-border ${src ? "bg-white" : "bg-primary-surface"} ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt={name ? `${name} logo` : "Logo"}
          referrerPolicy="no-referrer"
          draggable={false}
          className="h-full w-full object-contain p-[14%]"
          onError={() => setFailures({ key, count: failed + 1 })}
        />
      ) : (
        <span
          aria-hidden
          className="font-semibold leading-none text-primary"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
