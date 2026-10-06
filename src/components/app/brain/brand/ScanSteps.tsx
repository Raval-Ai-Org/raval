"use client";
// ScanSteps — what one Brand scan fills in: Brand, then Audience and
// Competitors from what it found. Three marks in a row; a mark pulses while its
// brain is being filled and gets a tick when it is done.
import { motion } from "framer-motion";
import { Check } from "@/components/icons";
import { BRAIN_META, type BrainId } from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import { BrainMark } from "../BrainMark";

/** `skipped`: the plan or a switch doesn't include that brain; it isn't shown. */
export type ScanStep = "idle" | "running" | "done" | "skipped";

const ORDER: BrainId[] = ["brand", "audience", "competitors"];

export function ScanSteps({
  brand,
  audience,
  competitors,
}: {
  brand: ScanStep;
  audience: ScanStep;
  competitors: ScanStep;
}) {
  const state: Record<string, ScanStep> = { brand, audience, competitors };
  const steps = ORDER.filter((id) => state[id] !== "skipped");
  const busy = steps.some((id) => state[id] === "running");
  return (
    <ol
      className="flex min-w-0 items-center"
      aria-label={busy ? "Scanning" : "What a scan fills in"}
      aria-live="polite"
    >
      {steps.map((id, i) => {
        const step = state[id];
        return (
          <li key={id} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "mx-1.5 h-px w-4 sm:w-6",
                  state[steps[i - 1]] === "done" ? "bg-primary/60" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "flex h-8 items-center gap-2 rounded-full px-2 transition-colors sm:pr-3",
                step === "running" ? "bg-[var(--ds-well-bg)]" : "",
              )}
              title={`${BRAIN_META[id].label}: ${step === "running" ? "working" : step === "done" ? "up to date" : "not scanned yet"}`}
            >
              <span className="relative grid h-5 w-5 place-items-center">
                <BrainMark
                  brain={id}
                  size={16}
                  active={step === "running"}
                  muted={step === "idle"}
                />
                {step === "done" && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 26 }}
                    className="absolute -bottom-1 -right-1 grid h-3 w-3 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
                  >
                    <Check className="h-2 w-2" strokeWidth={3.5} />
                  </motion.span>
                )}
              </span>
              <span
                className={cn(
                  "hidden text-[12.5px] font-medium sm:inline",
                  step === "idle" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {BRAIN_META[id].label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
