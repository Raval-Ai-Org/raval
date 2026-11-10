"use client";

// The picture on a campaign card: a real photograph of the moment (Diwali
// lamps, an Eid table, a Christmas tree…) with the moment's Mellox icon. No
// emoji. Decoration only, so it is hidden from screen readers; the card's
// words say what it is. If a photo fails to load, the theme's colour wash
// shows instead, so the card never looks broken.
import { useState } from "react";
import { campaignPhotoUrl, campaignTheme } from "@/lib/campaigns/theme";
import { cn } from "@/lib/utils";
import { kindIcon } from "./kit";

export function CampaignArt({
  title,
  type,
  size = "banner",
  className,
}: {
  title?: string | null;
  type?: string | null;
  /** "banner": the wide top of a card. "tile": a square badge. */
  size?: "banner" | "tile";
  className?: string;
}) {
  const t = campaignTheme({ title, type });
  const Icon = kindIcon(t.icon);
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = failed !== t.photo;
  const solid = `linear-gradient(145deg, ${t.from} 0%, ${t.to} 100%)`;

  const photo = showPhoto ? (
    <img
      src={campaignPhotoUrl(t.photo)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(t.photo)}
      // Inline size: some surfaces style bare <img>s (height: auto), which
      // would leave a 2:1 photo half-filling a square tile.
      style={{ width: "100%", height: "100%" }}
      className="absolute inset-0 object-cover transition-transform duration-700 group-hover:scale-[1.04]"
    />
  ) : null;

  if (size === "tile") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative grid size-10 shrink-0 select-none place-items-center overflow-hidden rounded-2xl text-white shadow-[0_6px_14px_-6px_rgb(0_0_0/0.35)] ring-1 ring-black/5 dark:ring-white/10",
          className,
        )}
        style={{ background: solid }}
      >
        {photo}
        {!showPhoto && <Icon className="relative size-[45%]" strokeWidth={2.1} />}
      </span>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "relative h-24 select-none overflow-hidden rounded-[16px] ring-1 ring-black/5 dark:ring-white/10",
        className,
      )}
      style={{ background: solid }}
    >
      {photo}
      {/* A soft shade at the bottom so the icon chip reads on any photo. */}
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
      <span
        className="absolute bottom-2.5 left-3 grid size-9 place-items-center overflow-hidden rounded-[13px] text-white shadow-[0_10px_20px_-10px_rgb(0_0_0/0.5)] ring-1 ring-white/50 transition-transform duration-500 group-hover:-rotate-6"
        style={{ background: solid }}
      >
        <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/2 rounded-full bg-white/25 blur-[3px]" />
        <Icon
          className="relative size-5 drop-shadow-[0_1px_2px_rgb(0_0_0/0.25)]"
          strokeWidth={2.1}
        />
      </span>
    </div>
  );
}
