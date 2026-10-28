"use client";
// VersionStrip — the picture in use and the other versions of it, under the
// preview. Choosing one makes it the post's picture (free); the one it
// replaces stays here, so a person can switch back.
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Spinner } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import type { MediaOutput } from "@/lib/studio/jobs";
import { pictureChoices } from "@/lib/studio/variations";

export function VersionStrip({
  media,
  ratio,
  disabled,
  onChoose,
}: {
  media: MediaOutput[] | undefined;
  /** CSS aspect-ratio of the thumbnails, e.g. "4 / 5". */
  ratio: string;
  disabled?: boolean;
  onChoose: (slot: string) => Promise<void> | void;
}) {
  const reduce = useReducedMotion();
  const [choosing, setChoosing] = useState<string | null>(null);
  const choices = pictureChoices(media);
  if (choices.length < 2) return null;
  return (
    <div className="mx-auto mt-4 w-full max-w-[600px]" data-testid="version-strip">
      <p className="mb-2 text-center text-[12px] text-muted-foreground">
        {choices.length} versions · tap one to use it
      </p>
      <ul className="flex justify-center gap-2" aria-label="Versions">
        {choices.map((m, i) => {
          const inUse = m.slot === "main";
          const pending = m.status === "pending";
          const failed = m.status === "failed";
          return (
            <motion.li
              key={`${m.slot}-${m.assetId ?? i}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.06, duration: duration.medium, ease: ease.emphasized }}
              className="w-[22%] max-w-[120px]"
            >
              <button
                type="button"
                disabled={disabled || inUse || pending || failed || !!choosing}
                aria-pressed={inUse}
                aria-label={
                  inUse
                    ? "Picture in use"
                    : failed
                      ? "Version couldn't be made"
                      : `Use version ${i + 1}`
                }
                onClick={async () => {
                  setChoosing(m.slot);
                  try {
                    await onChoose(m.slot);
                  } finally {
                    setChoosing(null);
                  }
                }}
                style={{ aspectRatio: ratio }}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-xl bg-surface-2 ring-1 transition-[box-shadow,transform] duration-[--motion-duration-fast]",
                  inUse
                    ? "ring-2 ring-primary"
                    : "ring-border hover:-translate-y-0.5 hover:shadow-2 disabled:hover:translate-y-0",
                )}
              >
                {m.url && m.status === "ready" ? (
                  <img src={m.url} alt="" className="size-full object-cover" loading="lazy" />
                ) : pending ? (
                  <span className="studio-weave absolute inset-0" aria-hidden />
                ) : (
                  <span className="grid size-full place-items-center px-1 text-center text-[10.5px] text-muted-foreground">
                    {failed ? "Not made" : ""}
                  </span>
                )}
                {inUse ? (
                  <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    <Check className="size-2.5" strokeWidth={3} /> In use
                  </span>
                ) : null}
                {choosing === m.slot ? (
                  <span className="absolute inset-0 grid place-items-center bg-background/50">
                    <Spinner className="size-4 animate-spin" />
                  </span>
                ) : null}
              </button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
