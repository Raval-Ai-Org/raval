"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { duration, ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { LibraryAsset } from "@/lib/library";
import type { Group, Stage } from "@/lib/studio/content-groups";
import { LibraryPage, type LibraryTab } from "./LibraryPage";

/** Preview/testing data (the Studio lab); the app renders the live Library. */
type Fixtures = {
  fixtureGroups?: Group[];
  fixtureThumbs?: Record<string, string>;
  fixtureAssets?: LibraryAsset[];
};

/**
 * The Library as a pop-up over the workspace. Opens from the sidebar, from
 * anywhere via the `open:library` app event, and from `?library=1` (the old
 * /app/library route redirects there). Escape steps back from a detail view
 * first, then closes.
 */
export function LibraryDialog(fixtures: Fixtures = {}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<LibraryTab>("all");
  const [status, setStatus] = useState<Stage | undefined>(undefined);
  const isMobile = useIsMobile();
  const backRef = useRef<(() => boolean) | null>(null);

  useEffect(() => {
    const on: Parameters<typeof addAppEventListener<"open:library">>[1] = (e) => {
      setTab(e.detail?.tab ?? "all");
      setStatus(e.detail?.status);
      setOpen(true);
    };
    addAppEventListener("open:library", on);
    try {
      const url = new URL(window.location.href);
      const param = url.searchParams.get("library");
      if (param) {
        setTab(param === "posts" || param === "media" ? param : "all");
        setOpen(true);
        url.searchParams.delete("library");
        const q = url.searchParams.toString();
        window.history.replaceState({}, "", url.pathname + (q ? `?${q}` : ""));
      }
    } catch {
      /* ignore */
    }
    return () => removeAppEventListener("open:library", on);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-background/60 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: duration.base } }}
                transition={{ duration: duration.base }}
              />
            </DialogPrimitive.Overlay>
            <div
              className={cn(
                "pointer-events-none fixed inset-0 z-50 grid place-items-center",
                !isMobile && "p-3",
              )}
            >
              <DialogPrimitive.Content
                asChild
                aria-describedby={undefined}
                onEscapeKeyDown={(e) => {
                  const t = e.target as HTMLElement | null;
                  if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
                    e.preventDefault();
                    t.blur();
                    return;
                  }
                  if (backRef.current?.()) e.preventDefault();
                }}
              >
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    y: 16,
                    scale: 0.98,
                    transition: { duration: duration.base, ease: ease.accelerate },
                  }}
                  transition={spring.surface}
                  className={cn(
                    "pointer-events-auto relative flex flex-col overflow-hidden bg-background shadow-4 outline-none",
                    isMobile
                      ? "h-dvh w-screen"
                      : "h-[min(92vh,900px)] w-[min(96vw,1280px)] rounded-[20px] ring-1 ring-border/80",
                  )}
                >
                  <DialogPrimitive.Title className="sr-only">Library</DialogPrimitive.Title>
                  <LibraryPage
                    {...fixtures}
                    initialTab={tab}
                    initialStatus={status}
                    onClose={() => setOpen(false)}
                    backRef={backRef}
                  />
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
