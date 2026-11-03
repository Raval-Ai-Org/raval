"use client";

// Inspo → Video look: pace, captions and motion (`dna.look.video`).
import { motion } from "framer-motion";
import { dsFocus } from "@/components/app/surface/buttons";
import { VideoPreview } from "@/components/app/brain/brand/look/preview";
import type { BrandLook } from "@/lib/brand-look/resolve";
import type { BrandLookSpec, VideoStyle } from "@/lib/brand-look/spec";
import { cn } from "@/lib/utils";
import { Block, EASE } from "./parts";
import { LivePreview } from "./PostLook";
import type { InspoHandlers } from "./types";

const PACES: Array<{ value: NonNullable<VideoStyle["pacing"]>; label: string; beat: number }> = [
  { value: "slow", label: "Slow", beat: 1.6 },
  { value: "steady", label: "Steady", beat: 0.9 },
  { value: "fast", label: "Fast", beat: 0.4 },
];

const POSITIONS = [
  { value: "top", label: "Top" },
  { value: "center", label: "Middle" },
  { value: "bottom", label: "Bottom" },
] as const;

export function VideoLook({
  spec,
  resolved,
  handlers,
}: {
  spec: BrandLookSpec;
  resolved: BrandLook;
  handlers: InspoHandlers;
}) {
  const vid = spec.video ?? {};
  const set = (patch: Partial<VideoStyle>) =>
    handlers.saveLook({ ...spec, video: { ...spec.video, ...patch } });
  const captionsOff = vid.captions?.show === false;
  const position = vid.captions?.position ?? "bottom";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <Block label="Pace">
          <div className="grid grid-cols-3 gap-2.5">
            {PACES.map((p) => {
              const on = vid.pacing === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ pacing: on ? undefined : p.value })}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-[20px] bg-[var(--ds-well-bg)] px-3 py-4 ring-1 transition-all hover:-translate-y-0.5",
                    on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                    dsFocus,
                  )}
                >
                  {/* Bars that move at the chosen pace. */}
                  <span className="flex h-8 items-end gap-1" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.span
                        key={i}
                        className={cn("w-1.5 rounded-full", on ? "bg-primary" : "bg-foreground/30")}
                        animate={{ height: ["30%", "100%", "45%", "80%", "30%"] }}
                        transition={{
                          duration: p.beat * 2,
                          repeat: Infinity,
                          delay: i * p.beat * 0.2,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </span>
                  <span className="text-[13px] font-semibold">{p.label}</span>
                </button>
              );
            })}
          </div>
        </Block>

        <Block label="Captions">
          <div className="flex flex-wrap items-center gap-5">
            {/* Tap where captions go on a phone. */}
            <div className="relative flex h-[188px] w-[106px] flex-col justify-between rounded-[22px] bg-foreground/90 p-2 ring-4 ring-[var(--ds-well-bg-hover)]">
              {POSITIONS.map((p) => {
                const on = !captionsOff && position === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-label={`Captions ${p.label.toLowerCase()}`}
                    aria-pressed={on}
                    onClick={() =>
                      set({ captions: { ...vid.captions, show: true, position: p.value } })
                    }
                    className={cn(
                      "relative h-12 rounded-[12px] transition-colors hover:bg-white/10",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-caption-pos"
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                        className="absolute inset-x-2 top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={captionsOff}
              onClick={() =>
                set({ captions: { ...vid.captions, show: captionsOff ? true : false } })
              }
              className={cn(
                "h-9 rounded-full px-4 text-[13px] font-semibold transition-all",
                captionsOff
                  ? "bg-primary/15 ring-1 ring-primary/40"
                  : "ds-well text-muted-foreground hover:text-foreground",
                dsFocus,
              )}
            >
              No captions
            </button>
          </div>
        </Block>

        <Block label="Motion">
          <motion.textarea
            layout
            className={cn(dsFocus, "ds-well w-full resize-none px-4 py-3 text-[13.5px]")}
            rows={3}
            maxLength={600}
            placeholder="Slow push-ins, soft cuts, warm music…"
            value={vid.notes ?? ""}
            onChange={(e) => set({ notes: e.target.value || undefined })}
            transition={{ ease: EASE }}
          />
        </Block>
      </div>

      <LivePreview stamp={JSON.stringify(vid)}>
        <VideoPreview resolved={resolved} />
      </LivePreview>
    </div>
  );
}
