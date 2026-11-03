"use client";

// The small picture on Brain → Brand's Inspo tile.
import * as React from "react";
import type { BrandDna } from "@/hooks/use-brand-dna";
import { resolveLook } from "@/lib/brand-look/resolve";
import {
  PostPreview,
  Swatches,
  paletteList,
  useLookFonts,
} from "@/components/app/brain/brand/look/preview";

export function InspoTilePreview({ dna }: { dna: BrandDna }) {
  const look = React.useMemo(() => resolveLook(dna as never), [dna]);
  useLookFonts(look);
  return (
    <div className="flex h-full items-center gap-3">
      <div className="w-[84px] shrink-0">
        <PostPreview resolved={look} brandName={dna.brandName || null} logoUrl={dna.logoUrl} />
      </div>
      <div className="min-w-0 space-y-2">
        <Swatches colors={paletteList(look)} />
        <div className="truncate text-[12px] text-muted-foreground">Look, voice & media</div>
      </div>
    </div>
  );
}
