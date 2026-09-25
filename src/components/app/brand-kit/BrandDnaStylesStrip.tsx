"use client";
// A strip inside Brand DNA: the styles built on top of it. Brand DNA holds the
// facts; styles hold the look and voice, and follow Brand DNA where they're
// linked to it.
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowRight, BrandKit, Plus, Star } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { fontStack, ensureGoogleFonts } from "@/lib/brand-kit/fonts";
import { useStyleOptions } from "./hooks";
import { Swatches } from "./preview";

export function BrandDnaStylesStrip({
  workspaceId,
  onNavigate,
}: {
  workspaceId: string | null;
  /** Called before opening the Brand Kit (e.g. to close the Brand DNA dialog). */
  onNavigate?: () => void;
}) {
  const query = useStyleOptions(workspaceId);
  const options = React.useMemo(() => query.data?.options ?? [], [query.data]);
  React.useEffect(() => {
    ensureGoogleFonts(options.map((o) => o.headingFont));
  }, [options]);
  if (!workspaceId) return null;
  const go = (detail?: { styleId?: string; create?: boolean }) => {
    onNavigate?.();
    emitAppEvent("open:brand-kit", detail);
  };
  return (
    <section className="mt-6">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-[13px] font-semibold">
          <BrandKit className="h-4 w-4 text-primary" /> Styles built on this
        </h4>
        <button
          type="button"
          onClick={() => go()}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Open Brand Kit <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {options.map((o, i) => (
          <motion.button
            key={o.id}
            type="button"
            onClick={() => go({ styleId: o.id })}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="ds-tile ds-tile-hover flex min-w-[170px] shrink-0 flex-col gap-2 p-3 text-left"
          >
            <div className="flex items-center justify-between">
              <Swatches colors={o.swatches} size={16} />
              {o.isDefault && <Star className="h-3.5 w-3.5 text-primary" />}
            </div>
            <div
              className="truncate text-[14px] font-semibold"
              style={{ fontFamily: fontStack(o.headingFont) }}
            >
              {o.name}
            </div>
          </motion.button>
        ))}
        <button
          type="button"
          onClick={() => go({ create: true })}
          className={cn(
            "flex min-w-[150px] shrink-0 flex-col items-start justify-center gap-1.5 rounded-[20px] border-2 border-dashed border-[var(--ds-tile-border)] p-3 text-left transition-colors hover:border-primary/50",
          )}
        >
          <Plus className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-medium">New style</span>
          <span className="text-[11.5px] text-muted-foreground">From examples or a sentence</span>
        </button>
      </div>
    </section>
  );
}
