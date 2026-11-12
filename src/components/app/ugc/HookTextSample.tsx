"use client";

// A small CSS drawing of a hook text preset (src/lib/ugc/hook-text.ts), the
// way the server draws it on the video (`renderHookCue`). Used on format cards
// and the preset swatches. Presentational.

import type { HookTextPresetId } from "@/lib/ugc/hook-text";
import { cn } from "@/lib/utils";

const OUTLINE = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000";

export function HookTextSample({
  preset,
  text,
  size = "sm",
  accent = "#ffe14d",
}: {
  preset: HookTextPresetId;
  text: string;
  size?: "xs" | "sm";
  accent?: string;
}) {
  const fs = size === "xs" ? "text-[8px]" : "text-[11px]";
  const words = preset === "pov" ? text.toLowerCase() : text;
  const base = cn("font-bold leading-tight text-center", fs);

  if (preset === "split-label") {
    const [left, right] = text.split(/\s+\/\s+/);
    return (
      <span className="flex w-full justify-around gap-1">
        {[left, right ?? ""].map((label, i) => (
          <span key={i} className={cn(base, "text-white")} style={{ textShadow: OUTLINE }}>
            {label}
          </span>
        ))}
      </span>
    );
  }
  if (preset === "reply") {
    return (
      <span className="flex min-w-0 max-w-full flex-col rounded-lg bg-white px-1.5 py-1 text-left shadow">
        <span className="truncate text-[7px] leading-tight text-neutral-500">
          Replying to @prove_it
        </span>
        <span className={cn("font-bold leading-tight text-neutral-900", fs)}>{words}</span>
      </span>
    );
  }
  if (preset === "headline") {
    return (
      <span className="flex flex-col items-start">
        <span className="bg-[#d7263d] px-1 text-[7px] font-bold tracking-wider text-white">
          BREAKING
        </span>
        <span className={cn(base, "bg-white px-1 uppercase text-neutral-900")}>{words}</span>
      </span>
    );
  }
  if (preset === "bubble") {
    return (
      <span className={cn(base, "rounded-md bg-white px-1.5 py-0.5 text-neutral-900")}>
        {words}
      </span>
    );
  }
  if (preset === "highlight") {
    return (
      <span className={cn(base, "rounded-sm bg-[#ffe14d] px-1 text-neutral-900")}>{words}</span>
    );
  }
  if (preset === "stacked") {
    const key = text.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
    return (
      <span
        className={cn(base, "text-white", size === "xs" ? "text-[10px]" : "text-[14px]")}
        style={{ textShadow: OUTLINE }}
      >
        {text.split(" ").map((w, i) => (
          <span key={i} style={w === key ? { color: accent } : undefined}>
            {i ? " " : ""}
            {w}
          </span>
        ))}
      </span>
    );
  }
  if (preset === "pov") {
    return (
      <span className={cn(base, "text-white")} style={{ textShadow: "0 1px 4px rgba(0,0,0,.7)" }}>
        {words}
      </span>
    );
  }
  // classic and word-pop look the same at rest.
  return (
    <span className={cn(base, "text-white")} style={{ textShadow: OUTLINE }}>
      {words}
    </span>
  );
}
