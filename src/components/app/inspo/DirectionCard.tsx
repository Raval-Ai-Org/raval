"use client";

// One learned direction drawn as a post, with the brand's own fonts, colours
// and the reference it came from. Presentational.
import type { BrandDna } from "@/hooks/use-brand-dna";
import { resolveLook } from "@/lib/brand-look/resolve";
import { fontStack } from "@/lib/brand-look/fonts";
import { applyVisualTaste } from "@/lib/brand-visuals/apply";
import {
  directionRules,
  type VisualProfile,
  type VisualSource,
} from "@/lib/brand-visuals/contracts";
import { carouselTheme } from "@/lib/studio/carousel/design";
import { cn } from "@/lib/utils";
import { useLookFonts } from "@/components/app/brain/brand/look/preview";

export function DirectionArt({
  dna,
  profile,
  index,
  sources,
}: {
  dna: BrandDna;
  profile: VisualProfile;
  index: number;
  sources: VisualSource[];
}) {
  const direction = profile.directions[index];
  const look = applyVisualTaste(resolveLook(dna), dna.look, {
    profileId: "preview",
    direction,
    rules: directionRules(direction),
    references: [],
    warnings: [],
  });
  useLookFonts(look);
  const theme = carouselTheme({
    palette: look.visual.palette,
    fonts: look.visual.typography,
    colorway: direction.colorway,
  });
  const anchors = direction.bible?.anchors ?? [];
  const reference = [...sources]
    .sort((a, b) => Number(anchors.includes(b.id)) - Number(anchors.includes(a.id)))
    .find(
      (s) =>
        direction.sourceIds.includes(s.id) &&
        s.status !== "removed" &&
        s.asset?.mime_type.startsWith("image/") &&
        s.region.type !== "full",
    );
  const soft = direction.layout === "soft";
  const bold = direction.layout === "bold";
  return (
    <div
      className={cn(
        "relative flex aspect-square overflow-hidden rounded-[18px] [container-type:inline-size]",
        direction.layout === "frame" ? "flex-col-reverse" : "flex-col",
        soft && "p-[3%]",
      )}
      style={{
        background: bold ? theme.accent : theme.bg,
        color: bold ? theme.accentInk : theme.ink,
      }}
    >
      <div
        className={cn("relative h-[60%] shrink-0 overflow-hidden", soft && "rounded-[14px]")}
        style={{ background: theme.surface }}
      >
        {reference?.asset?.url && (
          <img
            src={reference.asset.thumbnailUrl || reference.asset.url}
            alt=""
            decoding="async"
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 px-[6%] py-[3%]">
        <div
          className="text-[clamp(12px,6cqw,23px)] font-bold leading-tight"
          style={{
            fontFamily: fontStack(theme.headingFont),
            fontWeight: look.visual.typography?.headingWeight ?? 700,
          }}
        >
          {direction.bible?.type.emphasis === "italic-accent" ||
          direction.bible?.type.emphasis === "colour-word" ? (
            <>
              Made for your{" "}
              <span
                style={{
                  color: theme.accentInk === theme.ink ? theme.accent : theme.accent,
                  fontStyle:
                    direction.bible.type.emphasis === "italic-accent" ? "italic" : undefined,
                }}
              >
                next chapter
              </span>
            </>
          ) : (
            "Made for your next chapter"
          )}
        </div>
        <div
          className="text-[clamp(9px,3cqw,12px)] opacity-80"
          style={{ fontFamily: fontStack(theme.bodyFont) }}
        >
          {dna.brandName || "Your brand"}
        </div>
      </div>
    </div>
  );
}

/** What Mellox learned, in a few plain lines (the style bible, ADR-0048). */
const REGISTER_LABEL: Record<string, string> = {
  illustrated: "Illustrated",
  photographic: "Photographic",
  "designed-system": "Designed system",
  typographic: "Type-led",
  mixed: "",
};
const LOGO_LABEL: Record<string, string> = {
  always: "",
  often: "logo on most posts",
  sometimes: "logo on some posts",
  rarely: "logo rarely",
};

export function BibleNotes({ profile, index }: { profile: VisualProfile; index: number }) {
  const bible = profile.directions[index]?.bible;
  if (!bible) return null;
  const habit = [
    REGISTER_LABEL[bible.register],
    bible.text === "rich" ? "headline with supporting lines" : "",
    LOGO_LABEL[bible.logo],
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = [
    habit,
    bible.world.medium,
    bible.frame ? `Every post: ${bible.frame}` : bible.type.headline,
    bible.recurringSubject ? `Recurring: ${bible.recurringSubject.description}` : "",
    ...bible.signatures
      .filter((s) => s.kind !== "subject")
      .slice(0, 2)
      .map((s) => s.description),
  ]
    .filter(Boolean)
    .slice(0, 4);
  if (!lines.length) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 px-1 text-[11.5px] leading-snug text-muted-foreground">
      {lines.map((line) => (
        <li key={line} className="line-clamp-2">
          {line}
        </li>
      ))}
    </ul>
  );
}
