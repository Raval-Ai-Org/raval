import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders a real brand logo extracted from the workspace's website domain.
 * Uses Clearbit's public logo service (no API key required) with a graceful
 * fallback to a gradient tile with initials when no logo is available.
 */

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    const cleaned = url
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");
    return cleaned || null;
  }
}

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+|\.|-/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "W") + (parts[1]?.[0] ?? "")).toUpperCase();
}

type Props = {
  name: string;
  websiteUrl?: string | null;
  size?: number;
  className?: string;
  rounded?: "md" | "lg";
};

export function WorkspaceLogo({ name, websiteUrl, size = 28, className, rounded = "md" }: Props) {
  const domain = extractDomain(websiteUrl);
  const px = `${size}px`;
  const radius = rounded === "lg" ? "rounded-lg" : "rounded-md";
  const fontSize = Math.max(9, Math.round(size * 0.36));
  const pxSize = Math.max(64, size * 4);

  // Cascade of real-logo sources — first to load wins. Each has different
  // coverage, so on error we swap to the next before falling back to initials.
  const logoDevToken = import.meta.env.VITE_LOVABLE_CONNECTOR_LOGO_DEV_API_KEY as
    string | undefined;
  const sources: string[] = domain
    ? [
        logoDevToken
          ? `https://img.logo.dev/${domain}?token=${logoDevToken}&size=${pxSize}&format=png`
          : "",
        `https://logo.clearbit.com/${domain}?size=${pxSize}`,
        `https://icons.duckduckgo.com/ip3/${domain}.ico`,
        `https://www.google.com/s2/favicons?domain=${domain}&sz=${pxSize >= 128 ? 128 : 64}`,
      ].filter(Boolean)
    : [];

  const [srcIndex, setSrcIndex] = useState(0);

  useEffect(() => {
    setSrcIndex(0);
  }, [domain]);

  if (sources.length > 0 && srcIndex < sources.length) {
    return (
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden bg-white",
          radius,
          className,
        )}
        style={{ width: px, height: px }}
      >
        <img
          src={sources[srcIndex]}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setSrcIndex((i) => i + 1)}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] font-bold uppercase text-background",
        radius,
        className,
      )}
      style={{ width: px, height: px, fontSize: `${fontSize}px` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
