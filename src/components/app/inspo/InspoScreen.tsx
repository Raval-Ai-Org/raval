"use client";

// Inspo (ADR-0037): one place for how the brand's posts look and sound and
// the media Mellox uses. Presentational: the panel or /inspo-lab fills it.
import * as React from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  Camera,
  Image as ImageIcon,
  LayoutGrid,
  MessageCircle,
  RotateCcw,
  Video,
  X,
} from "@/components/icons";
import { dsFocus } from "@/components/app/surface/buttons";
import {
  SurfaceLayout,
  SurfacePage,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import { useLookFonts } from "@/components/app/brain/brand/look/preview";
import { resolveLook } from "@/lib/brand-look/resolve";
import { shelfCards } from "@/lib/inspo/board";
import type { InspoSection } from "@/lib/inspo/sections";
import { styleSteps, styleStrength } from "@/lib/inspo/strength";
import { cn } from "@/lib/utils";
import { Board } from "./Board";
import { Media } from "./Media";
import { EASE, StrengthRing } from "./parts";
import { PostLook } from "./PostLook";
import type { InspoHandlers, InspoView } from "./types";
import { VideoLook } from "./VideoLook";
import { Voice } from "./Voice";

const TITLES: Record<InspoSection, string> = {
  board: "Your board",
  post: "Post look",
  video: "Video look",
  voice: "Voice",
  media: "Your media",
};

function WallSkeleton() {
  return (
    <div className="columns-2 gap-3 sm:columns-3 xl:columns-4" aria-busy>
      {[220, 160, 260, 180, 240, 150, 200, 170].map((h, i) => (
        <div
          key={i}
          className="skeleton-shimmer mb-3 break-inside-avoid rounded-[20px] bg-[var(--ds-well-bg)]"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

export function InspoScreen({
  view,
  section,
  handlers,
}: {
  view: InspoView;
  section: InspoSection;
  handlers: InspoHandlers;
}) {
  const resolved = React.useMemo(() => resolveLook(view.dna as never), [view.dna]);
  useLookFonts(resolved);
  const steps = styleSteps({
    look: view.look,
    cards: view.cards,
    hasLogo: !!(view.dna.logoUrl || view.dna.logoAssetId),
    hasDirection: !!view.taste?.active,
  });
  const strength = styleStrength(steps);

  const items: SurfaceNavItem<InspoSection>[] = [
    {
      id: "board",
      label: "Board",
      icon: LayoutGrid,
      count: shelfCards(view.cards, "board").length,
    },
    { id: "post", label: "Post look", icon: ImageIcon },
    { id: "video", label: "Video look", icon: Video },
    { id: "voice", label: "Voice", icon: MessageCircle },
    { id: "media", label: "Media", icon: Camera, count: shelfCards(view.cards, "media").length },
  ];
  const loading = !view.taste && (section === "board" || section === "media");
  const unavailable =
    view.taste?.available === false && (section === "board" || section === "media");

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-full min-h-0" data-testid="inspo-screen">
        <SurfaceLayout
          label="Inspo"
          items={items}
          value={section}
          onChange={handlers.onSection}
          railTop={
            <button
              type="button"
              onClick={() => handlers.onSection("board")}
              className={cn(
                "w-full rounded-[20px] p-2 text-left transition-colors hover:bg-[var(--ds-well-bg)]",
                dsFocus,
              )}
            >
              <StrengthRing score={strength.score} level={strength.level} size={44} />
            </button>
          }
        >
          <SurfacePage title={TITLES[section]} key={section} className="ds-enter">
            {loading ? (
              <WallSkeleton />
            ) : unavailable ? (
              <p className="text-[13px] text-muted-foreground">Not available for this brand yet.</p>
            ) : section === "board" ? (
              <Board view={view} steps={steps} strength={strength} handlers={handlers} />
            ) : section === "post" ? (
              <PostLook view={view} spec={view.look} resolved={resolved} handlers={handlers} />
            ) : section === "video" ? (
              <VideoLook spec={view.look} resolved={resolved} handlers={handlers} />
            ) : section === "voice" ? (
              <Voice view={view} spec={view.look} handlers={handlers} />
            ) : (
              <Media view={view} handlers={handlers} />
            )}
          </SurfacePage>
        </SurfaceLayout>

        {/* Floating notes: an error, or Undo after a removal. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4">
          <AnimatePresence>
            {view.error && (
              <motion.div
                key="error"
                role="alert"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="pointer-events-auto flex max-w-[520px] items-center gap-2 rounded-full bg-destructive px-4 py-2 text-[13px] font-medium text-destructive-foreground shadow-lg"
              >
                <span className="min-w-0 flex-1">{view.error}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={handlers.dismissError}
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full hover:bg-white/15",
                    dsFocus,
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
            {view.removed && (
              <motion.div
                key="undo"
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="pointer-events-auto flex items-center gap-3 rounded-full bg-foreground py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-background shadow-lg"
                data-testid="inspo-undo"
              >
                Removed
                <button
                  type="button"
                  onClick={handlers.undo}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground",
                    dsFocus,
                  )}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Undo
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
