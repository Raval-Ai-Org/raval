"use client";
// What Autopilot still needs before it can do real work, each with the button
// that fixes it. Shown in setup and, for anything missing, on the home screen.
import { cn } from "@/lib/utils";
import { AlertTriangle, Check } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { Tile } from "@/components/app/surface/SurfaceLayout";
import type { ReadinessItem } from "@/lib/autopilot/contracts";

export function Readiness({
  items,
  onOpen,
  onlyMissing,
}: {
  items: ReadinessItem[];
  onOpen: (target: ReadinessItem["id"]) => void;
  onlyMissing?: boolean;
}) {
  const list = onlyMissing ? items.filter((i) => !i.ok) : items;
  if (!list.length) return null;
  return (
    <Tile className="overflow-hidden p-0 sm:p-0">
      <ul className="divide-y divide-border/50">
        {list.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                item.ok
                  ? "bg-success/12 text-success"
                  : item.required
                    ? "bg-warning/12 text-warning"
                    : "bg-[var(--ds-well-bg)] text-muted-foreground",
              )}
            >
              {item.ok ? (
                <Check className="h-4 w-4" strokeWidth={2.6} />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{item.label}</p>
              <p className="truncate text-[12px] text-muted-foreground">{item.detail}</p>
            </div>
            {!item.ok && (
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className={cn(
                  item.required ? dsPrimaryBtn : dsGhostBtn,
                  "h-8 shrink-0 px-3.5 text-[12.5px]",
                )}
              >
                {item.cta}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Tile>
  );
}
