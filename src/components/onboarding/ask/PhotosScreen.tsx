"use client";

import { useRef, useState, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, Spinner, Store, Users, X } from "@/components/icons";
import type { PhotosScreen as Screen } from "@/lib/onboarding/questions";
import type { InspoItem, InspoTag } from "@/components/onboarding/manual/use-manual-inspiration";
import { IMAGE_TYPES } from "@/lib/inspo/uploads";
import { cn } from "@/lib/utils";
import { Highlighted } from "./text";

/** The most photos this screen takes; more go in Inspo → Media later. */
export const MAX_ONBOARDING_PHOTOS = 10;

/**
 * What each photo is. Team photos are Inspo "Person" media; the place and the
 * work are the brand's own pictures, kept in Media folders a brief can name.
 */
const KINDS: { id: string; label: string; line: string; icon: typeof Users; tag: InspoTag }[] = [
  {
    id: "team",
    label: "Your team",
    line: "The people behind it",
    icon: Users,
    tag: { purpose: "person", folder: "Team" },
  },
  {
    id: "place",
    label: "Your place",
    line: "Shop, office, van, venue",
    icon: Store,
    tag: { purpose: "element", folder: "Place" },
  },
  {
    id: "work",
    label: "Your work",
    line: "Jobs done, what you make",
    icon: Briefcase,
    tag: { purpose: "element", folder: "Work" },
  },
];

/**
 * The brand's own photos, asked once in onboarding (Round 9). They are saved
 * as Inspo media the moment they're picked (free) and Studio places them as
 * they are (photo design, ADR-0036). Skipping is fine: Continue lives in the dock.
 */
export function PhotosScreen({
  screen,
  items,
  reduce,
  headingRef,
  onAdd,
  onRemove,
}: {
  screen: Screen;
  items: InspoItem[];
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onAdd: (files: File[], tag: InspoTag) => string | null;
  onRemove: (key: string) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const full = items.length >= MAX_ONBOARDING_PHOTOS;
  const countOf = (folder?: string) => items.filter((i) => i.tag?.folder === folder).length;

  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="ob-title shrink-0 px-2 text-center outline-none"
      >
        <Highlighted text={screen.title} />
      </h1>
      <p className="mt-1.5 max-w-[560px] shrink-0 px-4 text-center text-[13px] text-muted-foreground sm:text-[14px]">
        {problem ?? (full ? "That's 10. Add more in Inspo → Media later." : screen.sub)}
      </p>

      <div
        role="group"
        aria-label="Add your photos"
        className="mt-4 grid w-full max-w-[760px] shrink-0 grid-cols-3 gap-2 sm:gap-3"
      >
        {KINDS.map((k, i) => {
          const Icon = k.icon;
          const count = countOf(k.tag.folder);
          return (
            <motion.button
              key={k.id}
              type="button"
              disabled={full}
              onClick={() => inputs.current[k.id]?.click()}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: reduce ? 0 : 0.06 + i * 0.05,
                type: "spring",
                stiffness: 300,
                damping: 24,
              }}
              whileHover={reduce || full ? undefined : { y: -4 }}
              whileTap={reduce || full ? undefined : { scale: 0.95 }}
              className={cn(
                "ob-card relative flex flex-col items-center gap-1.5 rounded-[18px] px-2 py-4 text-center disabled:opacity-60 sm:py-6",
                count > 0 && "ob-card-on",
              )}
            >
              <span className="grid size-11 place-items-center rounded-full bg-foreground/[0.05] sm:size-12">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="text-[13px] font-semibold leading-tight sm:text-[14px]">
                {k.label}
              </span>
              <span className="hidden text-[11px] leading-tight text-muted-foreground sm:block">
                {k.line}
              </span>
              {count > 0 && (
                <span className="absolute right-2 top-2 grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10.5px] font-bold text-primary-foreground">
                  {count}
                </span>
              )}
              <input
                ref={(el) => {
                  inputs.current[k.id] = el;
                }}
                type="file"
                multiple
                accept={IMAGE_TYPES.join(",")}
                className="hidden"
                aria-label={`Add photos: ${k.label}`}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) setProblem(onAdd(files, k.tag));
                }}
              />
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 min-h-0 w-full max-w-[760px] flex-1 overflow-hidden">
        <ul className="grid grid-cols-5 gap-2 sm:gap-2.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.key}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                className="relative aspect-square overflow-hidden rounded-[12px] bg-muted"
                title={item.status === "error" ? item.error : item.label}
              >
                {item.preview && (
                  // A local preview of the picked file (object URL), not a remote image.
                  <img
                    src={item.preview}
                    alt={item.label}
                    className={cn("size-full object-cover", item.status !== "done" && "opacity-60")}
                  />
                )}
                {item.status === "uploading" && (
                  <span className="absolute inset-0 grid place-items-center">
                    <Spinner className="size-4 animate-spin" aria-label="Saving" />
                  </span>
                )}
                {item.status === "error" && (
                  <span className="absolute inset-x-0 bottom-0 bg-destructive/85 px-1 py-0.5 text-center text-[10px] font-medium text-white">
                    Not saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(item.key)}
                  aria-label={`Remove ${item.label}`}
                  className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/55 text-white transition hover:bg-black/75"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
