"use client";
// One-tap moods for the brand look editor.
import { cn } from "@/lib/utils";
import { dsFocus } from "@/components/app/surface/buttons";

export const MOODS: Array<{ label: string; value: string }> = [
  { label: "Clean", value: "clean and minimal, calm, lots of breathing room" },
  { label: "Bold", value: "bold and energetic, high contrast, confident" },
  { label: "Warm", value: "warm and friendly, soft, human" },
  { label: "Premium", value: "premium and refined, understated, elegant" },
  { label: "Playful", value: "playful and colourful, fun, lively" },
  { label: "Dark", value: "dark and moody, dramatic, cinematic" },
];

export function MoodChips({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (mood: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MOODS.map((m) => {
        const on = value === m.value;
        return (
          <button
            key={m.label}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : m.value)}
            className={cn(
              "h-9 rounded-full px-4 text-[13px] font-medium transition-all",
              on
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "ds-well text-muted-foreground hover:text-foreground",
              dsFocus,
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
