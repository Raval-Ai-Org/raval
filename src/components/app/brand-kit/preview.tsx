"use client";
// Live previews of a Style: a post, a carousel slide, an article header and a
// video frame, drawn with the style's real fonts and colours. Pure rendering —
// the same resolveStyle the server uses decides what the preview shows.
import * as React from "react";
import { cn } from "@/lib/utils";
import { resolveStyle, type ResolvedStyle } from "@/lib/brand-kit/resolve";
import { ensureGoogleFonts, fontStack, loadFontFile } from "@/lib/brand-kit/fonts";
import type { BrandKitDnaSummary, BrandStyleView, KitAssetView } from "@/lib/brand-kit/contracts";

export function resolveView(
  style: BrandStyleView | null,
  dna: BrandKitDnaSummary | null,
): ResolvedStyle {
  return resolveStyle(
    dna
      ? {
          brandName: dna.brandName,
          voice: dna.voice,
          colors: dna.colors,
          fonts: dna.fonts,
          logoUrl: dna.logoUrl,
        }
      : null,
    style
      ? {
          id: style.id,
          name: style.name,
          version: style.version,
          spec: style.spec,
          applies_to: style.appliesTo,
        }
      : null,
  );
}

/** Load the fonts a style uses (Google Fonts, or uploaded files from the kit). */
export function useStyleFonts(resolved: ResolvedStyle, assets?: KitAssetView[]) {
  const t = resolved.visual.typography ?? {};
  const fileHeading = t.files?.heading;
  const fileBody = t.files?.body;
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    ensureGoogleFonts([t.heading, t.body, t.accent, resolved.video.captions?.font]);
    const byId = new Map((assets ?? []).map((a) => [a.id, a]));
    const jobs: Promise<boolean>[] = [];
    for (const [role, family] of [
      ["heading", t.heading],
      ["body", t.body],
    ] as const) {
      const id = role === "heading" ? fileHeading : fileBody;
      const url = id ? byId.get(id)?.url : null;
      if (family && url) jobs.push(loadFontFile(family, url));
    }
    if (jobs.length) void Promise.all(jobs).then(() => bump((n) => n + 1));
  }, [t.heading, t.body, t.accent, resolved.video.captions?.font, fileHeading, fileBody, assets]);
}

function readableOn(hex: string | undefined): string {
  if (!hex) return "#111111";
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#111111" : "#ffffff";
}

export function paletteOf(resolved: ResolvedStyle) {
  const p = resolved.visual.palette;
  const bg = p.background ?? "#ffffff";
  const primary = p.primary ?? "#1f2937";
  return {
    bg,
    fg: p.text ?? readableOn(bg),
    primary,
    onPrimary: readableOn(primary),
    secondary: p.secondary ?? primary,
    accent: p.accent ?? p.secondary ?? primary,
  };
}

function caseOf(text: string, casing?: string) {
  if (casing === "upper") return text.toUpperCase();
  if (casing === "lower") return text.toLowerCase();
  if (casing === "title") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function sample(resolved: ResolvedStyle, brandName: string | null) {
  const ex = resolved.writing.examples?.[0]?.trim();
  const headline = resolved.writing.hooks?.[0]
    ? "Here's what changed this week"
    : `${brandName ?? "Your brand"}, in its own voice`;
  const body = ex
    ? ex.split(/\n+/)[0].slice(0, 140)
    : "Every post, image and video Mellox makes can follow this look and voice.";
  const emoji =
    resolved.writing.emoji === "none"
      ? ""
      : (resolved.writing.favoriteEmoji?.[0] ?? (resolved.writing.emoji ? "✨" : ""));
  const tags = resolved.writing.hashtags?.always?.slice(0, 2).map((t) => `#${t}`) ?? [];
  return { headline, body, emoji, tags };
}

const placementClass: Record<string, string> = {
  top: "justify-start",
  center: "justify-center",
  bottom: "justify-end",
  left: "justify-center items-start text-left",
  right: "justify-center items-end text-right",
};

/** Square social post. */
export function PostPreview({
  resolved,
  brandName,
  logoUrl,
  className,
}: {
  resolved: ResolvedStyle;
  brandName: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  const c = paletteOf(resolved);
  const t = resolved.visual.typography ?? {};
  const s = sample(resolved, brandName);
  const placement = resolved.visual.textPlacement ?? "bottom";
  const corner = resolved.visual.logo?.corner ?? "bottom-right";
  const showLogo = resolved.visual.logo?.use !== false && !!logoUrl;
  const tracking =
    t.tracking === "tight" ? "-0.03em" : t.tracking === "wide" ? "0.06em" : "-0.01em";
  return (
    <div
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-[18px] shadow-sm ring-1 ring-black/5 [container-type:inline-size]",
        className,
      )}
      style={{ background: c.bg, color: c.fg }}
    >
      {/* Colour field: primary block with secondary and accent marks. */}
      <div className="absolute inset-0">
        <div
          className="absolute -right-[18%] -top-[18%] h-[62%] w-[62%] rounded-full"
          style={{ background: c.primary, opacity: 0.92 }}
        />
        <div
          className="absolute bottom-[14%] left-[8%] h-[6px] w-[22%] rounded-full"
          style={{ background: c.accent }}
        />
        <div
          className="absolute right-[10%] top-[48%] h-[16%] w-[16%] rounded-[28%]"
          style={{ background: c.secondary, opacity: 0.85 }}
        />
      </div>
      {placement !== "none" && (
        <div
          className={cn(
            "relative flex h-full flex-col gap-1.5 p-[9%]",
            placementClass[placement] ?? "justify-end",
          )}
        >
          <div
            className="max-w-[82%] text-[clamp(15px,5.2cqw,26px)] font-bold leading-[1.05]"
            style={{
              fontFamily: fontStack(t.heading),
              letterSpacing: tracking,
              fontWeight: t.headingWeight ?? 700,
            }}
          >
            {caseOf(s.headline, t.casing)}
          </div>
          <div
            className="max-w-[80%] text-[clamp(10px,2.6cqw,13px)] leading-snug opacity-80"
            style={{ fontFamily: fontStack(t.body) }}
          >
            {s.body.slice(0, 90)}
            {s.emoji ? ` ${s.emoji}` : ""}
          </div>
        </div>
      )}
      {showLogo && (
        <img
          src={logoUrl!}
          alt=""
          className={cn(
            "absolute h-[11%] w-auto max-w-[26%] object-contain",
            corner.startsWith("top") ? "top-[5%]" : "bottom-[5%]",
            corner.endsWith("left") ? "left-[5%]" : "right-[5%]",
          )}
        />
      )}
    </div>
  );
}

/** One carousel slide. */
export function SlidePreview({ resolved, index = 1 }: { resolved: ResolvedStyle; index?: number }) {
  const c = paletteOf(resolved);
  const t = resolved.visual.typography ?? {};
  return (
    <div
      className="relative flex aspect-[4/5] w-full flex-col justify-between overflow-hidden rounded-[16px] p-[9%] ring-1 ring-black/5 [container-type:inline-size]"
      style={{ background: index % 2 ? c.bg : c.primary, color: index % 2 ? c.fg : c.onPrimary }}
    >
      <div
        className="text-[10px] font-semibold opacity-60"
        style={{ fontFamily: fontStack(t.body) }}
      >
        {String(index).padStart(2, "0")} / 05
      </div>
      <div
        className="text-[clamp(13px,4.4cqw,20px)] font-bold leading-tight"
        style={{ fontFamily: fontStack(t.heading) }}
      >
        {caseOf(index === 1 ? "Five things we learned" : "Start with one clear idea", t.casing)}
      </div>
      <div
        className="h-[5px] w-[30%] rounded-full"
        style={{ background: index % 2 ? c.accent : c.onPrimary }}
      />
    </div>
  );
}

/** Article header on a page. */
export function ArticlePreview({
  resolved,
  brandName,
}: {
  resolved: ResolvedStyle;
  brandName: string | null;
}) {
  const c = paletteOf(resolved);
  const t = resolved.visual.typography ?? {};
  const s = sample(resolved, brandName);
  return (
    <div className="w-full overflow-hidden rounded-[16px] bg-white p-5 text-[#111] ring-1 ring-black/5 dark:bg-[#111] dark:text-white">
      <div
        className="mb-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ background: c.primary, color: c.onPrimary }}
      >
        Guide
      </div>
      <div
        className="text-[19px] font-bold leading-tight"
        style={{ fontFamily: fontStack(t.heading) }}
      >
        {caseOf("How to get more from every post", t.casing === "upper" ? "title" : t.casing)}
      </div>
      <p
        className="mt-2 text-[12.5px] leading-relaxed opacity-75"
        style={{ fontFamily: fontStack(t.body) }}
      >
        {s.body}
      </p>
      <div className="mt-3 h-px w-full bg-current opacity-10" />
      <div className="mt-2 text-[11px] opacity-60" style={{ fontFamily: fontStack(t.body) }}>
        5 min read {s.tags.length ? `· ${s.tags.join(" ")}` : ""}
      </div>
    </div>
  );
}

/** A vertical video frame with burned-in captions in the style. */
export function VideoPreview({
  resolved,
  posterUrl,
}: {
  resolved: ResolvedStyle;
  posterUrl?: string | null;
}) {
  const c = paletteOf(resolved);
  const cap = resolved.video.captions ?? {};
  const pos = cap.position ?? "bottom";
  const show = cap.show !== false;
  return (
    <div
      className="relative aspect-[9/16] w-full overflow-hidden rounded-[16px] ring-1 ring-black/5 [container-type:inline-size]"
      style={{
        background: posterUrl ? "#000" : `linear-gradient(160deg, ${c.primary}, ${c.secondary})`,
      }}
    >
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
      )}
      {show && (
        <div
          className={cn(
            "absolute inset-x-[8%] text-center",
            pos === "top"
              ? "top-[16%]"
              : pos === "center"
                ? "top-1/2 -translate-y-1/2"
                : "bottom-[22%]",
          )}
        >
          <span
            className="rounded-[6px] px-1.5 py-0.5 text-[clamp(11px,4.8cqw,16px)] font-extrabold leading-snug [box-decoration-break:clone]"
            style={{
              fontFamily: fontStack(cap.font ?? resolved.visual.typography?.heading),
              color: cap.color ?? "#ffffff",
              background: cap.highlight ?? "rgba(0,0,0,0.35)",
            }}
          >
            This is how it{" "}
            <span style={{ color: cap.highlight ? (cap.color ?? "#fff") : c.accent }}>looks</span>
          </span>
        </div>
      )}
      <div className="absolute bottom-[6%] left-[8%] flex items-center gap-1.5 text-[10px] font-medium text-white/85">
        <span className="h-1.5 w-1.5 rounded-full bg-white/85" />
        {resolved.video.pacing ? `${resolved.video.pacing} pacing` : "video"}
      </div>
    </div>
  );
}

/** Up to five swatches in a row. */
export function Swatches({
  colors,
  size = 18,
  className,
}: {
  colors: string[];
  size?: number;
  className?: string;
}) {
  if (!colors.length) return null;
  return (
    <div className={cn("flex items-center", className)}>
      {colors.slice(0, 5).map((hex, i) => (
        <span
          key={`${hex}-${i}`}
          className="rounded-full ring-2 ring-[var(--ds-tile-bg)]"
          style={{ background: hex, width: size, height: size, marginLeft: i ? -size / 3.2 : 0 }}
          title={hex}
        />
      ))}
    </div>
  );
}

export function paletteList(resolved: ResolvedStyle): string[] {
  const p = resolved.visual.palette;
  return [p.primary, p.secondary, p.accent, p.background, p.text, ...(p.extra ?? [])].filter(
    (h, i, all): h is string => !!h && all.indexOf(h) === i,
  );
}
