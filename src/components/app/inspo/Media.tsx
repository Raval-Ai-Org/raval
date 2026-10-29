"use client";

// Inspo → Media: the brand's own product shots, people and clips. Studio
// designs around these; they are never redrawn into something else.
import * as React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Plus, ShoppingBag } from "@/components/icons";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { MEDIA_CHIPS, shelfCards, type InspoChip } from "@/lib/inspo/board";
import { cn } from "@/lib/utils";
import { CardWall, CHIP_ICON, EASE, InspoCardView, InspoDrop, UploadCardView } from "./parts";
import type { InspoHandlers, InspoView } from "./types";

export function Media({ view, handlers }: { view: InspoView; handlers: InspoHandlers }) {
  const [addAs, setAddAs] = React.useState<InspoChip>("product");
  const canEdit = !!view.taste?.canEdit;
  const media = shelfCards(view.cards, "media");
  const uploads = view.uploads.filter((u) => u.chip === "product" || u.chip === "person");
  // Pictures the scan found on the site (the old Assets list), ready to keep.
  const known = new Set(view.cards.map((c) => c.label));
  const fromSite = view.dna.assets
    .filter((a) => (a.kind === "image" || a.kind === "design") && /^https?:\/\//.test(a.url))
    .filter((a) => !known.has(a.label))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => handlers.openBrand("logo")}
          className={cn(
            "group flex flex-col items-center justify-center gap-3 rounded-[28px] bg-[var(--ds-tile-bg)] p-4 ring-1 ring-[var(--ds-tile-border)] transition-all hover:-translate-y-0.5 hover:ring-primary/40",
            dsFocus,
          )}
        >
          <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-[20px] bg-[var(--ds-well-bg)]">
            {view.dna.logoUrl ? (
              <img src={view.dna.logoUrl} alt="Logo" className="max-h-16 max-w-16 object-contain" />
            ) : (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
          </span>
          <span className="text-[12.5px] font-semibold">Logo</span>
        </button>
        <div className="space-y-2.5">
          <InspoDrop
            compact
            title={addAs === "person" ? "Add photos of your people" : "Add product photos & clips"}
            disabled={!canEdit}
            onFiles={(files) => handlers.upload(files, addAs)}
            onLink={(url) => handlers.addLink(url, addAs)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="ds-well inline-flex p-0.5">
              {MEDIA_CHIPS.map((chip) => {
                const Icon = CHIP_ICON[chip];
                const on = addAs === chip;
                return (
                  <button
                    key={chip}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAddAs(chip)}
                    className={cn(
                      "relative inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
                      on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-media-as"
                        className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-primary/30"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5" />
                    <span className="relative">{chip === "product" ? "Product" : "Person"}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => handlers.openBrand("products")}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            >
              <ShoppingBag className="h-3.5 w-3.5" /> Products <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {fromSite.length > 0 && canEdit && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-muted-foreground">From your site</div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {fromSite.map((a, i) => (
              <motion.button
                key={a.id}
                type="button"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
                onClick={() => handlers.addLink(a.url, addAs)}
                className={cn(
                  "group relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]",
                  dsFocus,
                )}
                aria-label={`Keep ${a.label}`}
              >
                <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Plus className="h-5 w-5" />
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {(media.length > 0 || uploads.length > 0) && (
        <CardWall testId="inspo-media">
          {uploads.map((u) => (
            <UploadCardView key={u.id} upload={u} />
          ))}
          {media.map((card) => (
            <InspoCardView
              key={card.id}
              card={card}
              chips={MEDIA_CHIPS}
              canEdit={canEdit}
              onChip={(chip) => handlers.setChip(card, chip)}
              onRemove={() => handlers.remove(card)}
              onUse={() => handlers.useInPost(card)}
            />
          ))}
        </CardWall>
      )}
    </div>
  );
}
