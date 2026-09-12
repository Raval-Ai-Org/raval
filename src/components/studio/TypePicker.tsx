"use client";

import { cn } from "@/lib/utils";
import { STUDIO_FORMATS, STUDIO_GROUPS, type StudioType } from "@/lib/studio/formats";
import { TypeGlyph } from "./studio-ui";

/** The full creation menu, grouped by what people are trying to make. */
export function TypePicker({
  value,
  onPick,
  compact = false,
  className,
}: {
  value?: StudioType;
  onPick: (type: StudioType) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {STUDIO_GROUPS.map((group) => (
        <section data-no-rhythm key={group.id} aria-labelledby={`studio-group-${group.id}`}>
          <h3 id={`studio-group-${group.id}`} className="ui-eyebrow mb-1.5 px-1">
            {group.label}
          </h3>
          <ul
            className={cn("grid gap-1.5", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}
          >
            {group.types.map((type) => {
              const f = STUDIO_FORMATS[type];
              const selected = value === type;
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => onPick(type)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "group flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors duration-[--motion-duration-fast]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                      selected
                        ? "border-primary-border bg-primary-surface"
                        : "border-border bg-surface-3 hover:border-border-strong hover:bg-surface-2",
                    )}
                  >
                    <TypeGlyph type={type} className={selected ? "bg-surface-3" : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{f.label}</span>
                      {!compact || selected ? (
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {f.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
