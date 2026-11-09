"use client";

// The picture on a campaign card: the moment's own emoji (🎃 for Halloween,
// 🪔 for Diwali…) over a soft wash of its colours. Decoration only, so it is
// hidden from screen readers; the card's words say what it is.
import { campaignTheme } from "@/lib/campaigns/theme";
import { cn } from "@/lib/utils";

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
  const wash = `linear-gradient(135deg, ${t.from}38 0%, ${t.to}30 100%)`;
  if (size === "tile") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative grid size-10 shrink-0 select-none place-items-center overflow-hidden rounded-2xl ring-1 ring-black/5 dark:ring-white/10",
          className,
        )}
        style={{ background: wash }}
      >
        <span className="text-[20px] leading-none transition-transform duration-300 group-hover:scale-110">
          {t.art[0]}
        </span>
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
      style={{ background: wash }}
    >
      <span
        className="absolute -right-6 -top-8 size-28 rounded-full blur-2xl"
        style={{ background: `${t.to}55` }}
      />
      <span
        className="absolute -bottom-10 -left-6 size-28 rounded-full blur-2xl"
        style={{ background: `${t.from}55` }}
      />
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[46px] leading-none drop-shadow-[0_8px_14px_rgb(0_0_0/0.18)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110">
        {t.art[0]}
      </span>
      <span className="absolute right-12 top-3 rotate-12 text-[26px] leading-none opacity-90 transition-transform duration-500 group-hover:-translate-y-1">
        {t.art[1]}
      </span>
      <span className="absolute bottom-3 right-5 -rotate-12 text-[22px] leading-none opacity-80 transition-transform duration-500 group-hover:translate-x-1">
        {t.art[2]}
      </span>
    </div>
  );
}
