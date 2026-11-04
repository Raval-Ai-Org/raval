"use client";

// The top bar's centre (Holo's "improves with every piece" line): how much of
// the brand Mox knows, from the free Start-here count. A click opens the
// checklist. It steps aside once everything is set up.

import { useStartHere } from "@/components/app/home/use-start-here";
import { GradProgress } from "@/components/app/surface/MoxParts";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { emitAppEvent } from "@/lib/app-events";

export function BrandMeter({ workspaceId }: { workspaceId: string }) {
  const start = useStartHere(workspaceId);
  if (!start.ready || start.complete) return null;
  return (
    <button
      type="button"
      onClick={() => emitAppEvent("open:start-here")}
      title="Start here"
      className="group hidden items-center gap-2.5 rounded-full px-3 py-1.5 transition hover:bg-[var(--ds-card-bg)] hover:shadow-[var(--ds-card-shadow)] xl:inline-flex"
    >
      <MoxFace mood="happy" size={22} />
      <span className="text-[12px] font-semibold text-foreground/80 group-hover:text-foreground">
        Mox knows your brand
      </span>
      <GradProgress value={start.done / start.total} label="Brand set up" className="w-24" />
      <span className="text-[12px] font-bold tabular-nums text-foreground">
        {start.done}/{start.total}
      </span>
    </button>
  );
}
