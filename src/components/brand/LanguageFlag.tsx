// A content language's flag (Mellox 2.0, Holo's flag grid). Real square SVG flags
// (1x1, drawn for round stickers, so nothing is cut off in the circle),
// because Windows can't draw flag emoji. Only the flags the language list
// uses are imported, so the rest never reach the bundle.

import {
  BD,
  BR,
  CN,
  CZ,
  DE,
  DK,
  ES,
  FI,
  FR,
  GB,
  GR,
  HU,
  ID,
  IL,
  IN,
  IR,
  IT,
  JP,
  KE,
  KR,
  LK,
  MY,
  NL,
  NO,
  PH,
  PK,
  PL,
  RO,
  RU,
  SA,
  SE,
  TH,
  TR,
  TW,
  UA,
  VN,
  ZA,
} from "country-flag-icons/react/1x1";
import { cn } from "@/lib/utils";

const FLAGS = {
  BD,
  BR,
  CN,
  CZ,
  DE,
  DK,
  ES,
  FI,
  FR,
  GB,
  GR,
  HU,
  ID,
  IL,
  IN,
  IR,
  IT,
  JP,
  KE,
  KR,
  LK,
  MY,
  NL,
  NO,
  PH,
  PK,
  PL,
  RO,
  RU,
  SA,
  SE,
  TH,
  TR,
  TW,
  UA,
  VN,
  ZA,
} as const;

export function LanguageFlag({ country, className }: { country: string; className?: string }) {
  const Flag = FLAGS[country as keyof typeof FLAGS];
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden rounded-full bg-[var(--ds-well-bg)] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08),0_2px_6px_-2px_rgb(0_0_0/0.25)]",
        className,
      )}
    >
      {Flag && (
        <Flag className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" />
      )}
      {/* A soft gloss so the flag reads as a round sticker. */}
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(70%_55%_at_35%_25%,rgb(255_255_255/0.45),transparent_60%)]" />
    </span>
  );
}
