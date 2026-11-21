// A drawn portrait for a ready-made creator (src/lib/ugc/creators.ts).
// Code-drawn on purpose: the creators are written personas, never photos of
// real people, so the picker shows who they are without borrowing a face.

import {
  creatorPhotoPath,
  type CreatorPortraitTraits,
  type StockCreator,
} from "@/lib/ugc/creators";
import { cn } from "@/lib/utils";

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function HairBack({ t }: { t: CreatorPortraitTraits }) {
  switch (t.hairStyle) {
    case "long":
      return (
        <path
          d="M58 92 C54 52 76 34 100 34 C124 34 146 52 142 92 L148 178 L52 178 Z"
          fill={t.hair}
        />
      );
    case "wavy":
      return (
        <path
          d="M56 96 C50 54 76 34 100 34 C124 34 150 54 144 96 C152 118 140 132 148 152 L52 152 C60 132 48 118 56 96 Z"
          fill={t.hair}
        />
      );
    case "curly":
      return (
        <g fill={t.hair}>
          <circle cx="100" cy="58" r="36" />
          <circle cx="70" cy="70" r="22" />
          <circle cx="130" cy="70" r="22" />
          <circle cx="66" cy="96" r="16" />
          <circle cx="134" cy="96" r="16" />
        </g>
      );
    case "bob":
      return (
        <path
          d="M58 92 C54 50 76 34 100 34 C124 34 146 50 142 92 L144 126 L56 126 Z"
          fill={t.hair}
        />
      );
    case "covered":
      return (
        <path
          d="M52 104 C48 52 76 30 100 30 C124 30 152 52 148 104 C150 140 138 168 130 182 L70 182 C62 168 50 140 52 104 Z"
          fill={t.hair}
        />
      );
    default:
      return null;
  }
}

function HairFront({ t }: { t: CreatorPortraitTraits }) {
  switch (t.hairStyle) {
    case "short":
      return (
        <path
          d="M66 76 C64 50 82 38 100 38 C120 38 138 50 134 76 C124 62 110 58 98 60 C86 62 74 66 66 76 Z"
          fill={t.hair}
        />
      );
    case "buzz":
      return (
        <path
          d="M68 72 C68 50 84 42 100 42 C116 42 132 50 132 72 C120 62 80 62 68 72 Z"
          fill={t.hair}
          opacity={0.9}
        />
      );
    case "bun":
      return (
        <g fill={t.hair}>
          <circle cx="100" cy="30" r="14" />
          <path d="M66 78 C64 50 82 40 100 40 C118 40 136 50 134 78 C122 60 78 60 66 78 Z" />
        </g>
      );
    case "bob":
      return (
        <path d="M66 82 C66 52 82 42 100 42 C118 42 134 52 134 82 L126 70 L74 70 Z" fill={t.hair} />
      );
    case "long":
    case "wavy":
      return (
        <path
          d="M66 82 C66 52 82 40 100 40 C120 40 134 52 134 82 C120 64 96 58 66 82 Z"
          fill={t.hair}
        />
      );
    case "curly":
      return (
        <g fill={t.hair}>
          <circle cx="82" cy="56" r="14" />
          <circle cx="100" cy="50" r="15" />
          <circle cx="118" cy="56" r="14" />
        </g>
      );
    case "covered":
      return (
        <path
          d="M64 86 C62 54 82 40 100 40 C118 40 138 54 136 86 C130 64 118 56 100 56 C82 56 70 64 64 86 Z"
          fill={shade(t.hair, -0.06)}
        />
      );
  }
}

export function CreatorPortrait({
  traits: t,
  className,
  title,
}: {
  traits: CreatorPortraitTraits;
  className?: string;
  title?: string;
}) {
  const skinShadow = shade(t.skin, -0.08);
  return (
    <svg
      viewBox="0 0 200 240"
      className={cn("size-full", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      preserveAspectRatio="xMidYMid slice"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <radialGradient id={`bg-${t.backdrop.slice(1)}`} cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor={shade(t.backdrop, 0.06)} />
          <stop offset="100%" stopColor={shade(t.backdrop, -0.06)} />
        </radialGradient>
      </defs>
      <rect width="200" height="240" fill={`url(#bg-${t.backdrop.slice(1)})`} />
      <HairBack t={t} />
      {/* shoulders */}
      <path d="M28 240 C30 196 60 176 100 176 C140 176 170 196 172 240 Z" fill={t.top} />
      <path d="M84 170 L116 170 L112 188 C106 194 94 194 88 188 Z" fill={skinShadow} />
      {/* neck */}
      <rect x="88" y="128" width="24" height="50" rx="10" fill={skinShadow} />
      {/* face */}
      <ellipse cx="100" cy="94" rx="34" ry="42" fill={t.skin} />
      <ellipse cx="66" cy="98" rx="6" ry="9" fill={t.skin} />
      <ellipse cx="134" cy="98" rx="6" ry="9" fill={t.skin} />
      {t.beard ? (
        <path
          d="M68 100 C70 130 84 138 100 138 C116 138 130 130 132 100 C126 116 116 122 100 122 C84 122 74 116 68 100 Z"
          fill={t.hair}
          opacity={0.75}
        />
      ) : null}
      {/* eyes and smile */}
      <ellipse cx="87" cy="94" rx="3.2" ry="3.8" fill="#2b211c" />
      <ellipse cx="113" cy="94" rx="3.2" ry="3.8" fill="#2b211c" />
      <path
        d="M80 84 Q87 80 94 84"
        stroke={shade(t.hair, -0.1)}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M106 84 Q113 80 120 84"
        stroke={shade(t.hair, -0.1)}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M99 100 Q97 108 101 110"
        stroke={skinShadow}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M88 118 Q100 127 112 118"
        stroke="#8a3f36"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      {t.glasses ? (
        <g stroke="#2b2622" strokeWidth="2.2" fill="none">
          <circle cx="87" cy="94" r="10" />
          <circle cx="113" cy="94" r="10" />
          <path d="M97 94 L103 94" />
        </g>
      ) : null}
      <HairFront t={t} />
    </svg>
  );
}

/** A ready-made creator's face: their generated photo, or the drawn portrait until there is one. */
export function CreatorFace({ creator, className }: { creator: StockCreator; className?: string }) {
  const photo = creatorPhotoPath(creator.id);
  if (photo)
    return (
      <img
        src={`/${photo}`}
        alt=""
        loading="lazy"
        className={cn("size-full! object-cover", className)}
      />
    );
  return <CreatorPortrait traits={creator.portrait} className={className} />;
}
