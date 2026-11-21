"use client";

// Mox, the Mellox guide, as a 3D render (public/brand/mox/). Four poses:
//   visor  wearing the glowing VR headset (scans, the entry cinematic)
//   face   front-on, friendly (questions, greetings)
//   wave   full body, waving (welcome, finish, empty states)
//   hero   3/4 shot on the Mox gradient (sign-in, big moments)
// Cut-out renders float gently and sit on a soft shadow that breathes.
// For anything icon-sized use MoxFace.

import Image from "next/image";
import { cn } from "@/lib/utils";

export type MoxPose = "visor" | "face" | "wave" | "hero";

const POSES: Record<MoxPose, { src: string; w: number; h: number; alt: string }> = {
  visor: { src: "/brand/mox/visor.webp", w: 1456, h: 1080, alt: "Mox wearing a VR headset" },
  face: { src: "/brand/mox/face.webp", w: 1230, h: 1278, alt: "Mox" },
  wave: { src: "/brand/mox/wave.webp", w: 1142, h: 1377, alt: "Mox waving" },
  hero: { src: "/brand/mox/hero.webp", w: 1254, h: 1254, alt: "Mox" },
};

export function moxSrc(pose: MoxPose): string {
  return POSES[pose].src;
}

export function Mox({
  pose = "face",
  size = 120,
  float = true,
  shadow = true,
  priority = false,
  className,
  alt,
}: {
  pose?: MoxPose;
  /** Width in px; height follows the render. */
  size?: number;
  float?: boolean;
  shadow?: boolean;
  priority?: boolean;
  className?: string;
  /** Pass "" when the render is decoration next to text that says the same. */
  alt?: string;
}) {
  const p = POSES[pose];
  const height = Math.round((size * p.h) / p.w);
  const cutout = pose !== "hero";
  return (
    <span
      className={cn("relative inline-flex shrink-0 flex-col items-center", className)}
      style={{ width: size }}
    >
      <span className={cn("block", float && cutout && "mox-float")}>
        <Image
          src={p.src}
          width={size}
          height={height}
          alt={alt ?? p.alt}
          priority={priority}
          draggable={false}
          className={cn("select-none", pose === "hero" && "rounded-[22%]")}
          // The renders fade into white at the bottom; a soft mask hides the
          // rim the cut-out leaves there.
          style={
            cutout && pose !== "wave"
              ? {
                  maskImage: "linear-gradient(to bottom, #000 78%, transparent 98%)",
                  WebkitMaskImage: "linear-gradient(to bottom, #000 78%, transparent 98%)",
                }
              : undefined
          }
        />
      </span>
      {shadow && cutout && (
        <span
          aria-hidden
          className="pointer-events-none -mt-2 h-3 rounded-[50%] bg-black/30 blur-md dark:bg-black/70"
          style={{
            width: size * 0.55,
            animation: float ? "mox-shadow 4.2s ease-in-out infinite" : undefined,
          }}
        />
      )}
    </span>
  );
}
