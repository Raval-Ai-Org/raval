"use client";

// The kind of post (categories.ts): grouped tiles at the top of Studio's
// Options panel. "Auto" leaves the pick to Write it for me / the brief. A pick
// steers every writer, the picture and a carousel's structure.
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { ComponentType } from "react";
import {
  BookOpen,
  Camera,
  Check,
  Columns2,
  Eye,
  Flame,
  Laugh,
  Leaf,
  Lightbulb,
  ListOrdered,
  MapPin,
  Package,
  Quote,
  Rocket,
  Scale,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Vote,
} from "@/components/icons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  CATEGORY_GROUPS,
  categoriesFor,
  categoryById,
  type Category,
  type CategoryId,
} from "@/lib/studio/categories";
import type { StudioType } from "@/lib/studio/formats";

type GlyphIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

const GLYPHS: Record<Category["glyph"], GlyphIcon> = {
  tag: Tag,
  box: Package,
  rocket: Rocket,
  laugh: Laugh,
  eye: Eye,
  flame: Flame,
  bulb: Lightbulb,
  scale: Scale,
  split: Columns2,
  star: Star,
  camera: Camera,
  book: BookOpen,
  vote: Vote,
  quote: Quote,
  pin: MapPin,
  leaf: Leaf,
  list: ListOrdered,
  phone: Smartphone,
};

export function CategoryPicker({
  type,
  value,
  onChange,
  disabled,
}: {
  type: StudioType;
  value?: CategoryId;
  onChange: (next: CategoryId | undefined) => void;
  disabled?: boolean;
}) {
  const reduce = useReducedMotionSafe();
  const list = categoriesFor(type);
  // A category saved for another format is shown as Auto here.
  const selected = list.some((c) => c.id === value) ? categoryById(value) : null;
  if (!list.length) return null;

  return (
    <div>
      <div className="mb-2 space-y-0.5">
        <p className="text-xs font-medium text-foreground">Kind of post</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={selected?.id ?? "auto"}
            initial={reduce ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -3 }}
            transition={{ duration: duration.fast, ease: ease.emphasized }}
            className="min-h-4 text-[11px] leading-4 text-muted-foreground"
          >
            {selected ? selected.whyItSpreads : "Mellox picks one that fits"}
          </motion.p>
        </AnimatePresence>
      </div>

      <LayoutGroup id="studio-category">
        <div className="space-y-3" role="radiogroup" aria-label="Kind of post">
          <Tile
            label="Auto"
            tagline="Best fit for your idea and goal"
            Icon={Sparkles}
            active={!selected}
            disabled={disabled}
            reduce={reduce}
            onClick={() => onChange(undefined)}
            index={0}
          />
          {CATEGORY_GROUPS.map((group) => {
            const items = list.filter((c) => c.group === group.id);
            if (!items.length) return null;
            return (
              <div key={group.id}>
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map((c, i) => (
                    <Tile
                      key={c.id}
                      label={c.label}
                      tagline={c.tagline}
                      Icon={GLYPHS[c.glyph] ?? Sparkles}
                      active={selected?.id === c.id}
                      disabled={disabled}
                      reduce={reduce}
                      index={i + 1}
                      onClick={() => onChange(selected?.id === c.id ? undefined : c.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}

function Tile({
  label,
  tagline,
  Icon,
  active,
  disabled,
  reduce,
  index,
  onClick,
}: {
  label: string;
  tagline: string;
  Icon: GlyphIcon;
  active: boolean;
  disabled?: boolean;
  reduce: boolean;
  index: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      title={tagline}
      disabled={disabled}
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: duration.base,
        ease: ease.emphasized,
        delay: reduce ? 0 : Math.min(index, 8) * 0.025,
      }}
      whileHover={reduce || disabled ? undefined : { y: -1 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      className={cn(
        "group relative flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-2xl border px-2.5 py-2 text-left",
        "transition-[border-color,box-shadow] duration-[--motion-duration-fast]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50",
        active
          ? "border-primary-border shadow-[0_8px_22px_-14px_hsl(var(--primary)/0.9)]"
          : "border-border bg-surface-3 hover:border-border-strong",
      )}
    >
      {active ? (
        <motion.span
          layoutId="studio-category-active"
          aria-hidden
          className="absolute inset-0 bg-primary-surface"
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
        />
      ) : null}
      <span
        className={cn(
          "relative mt-px grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-[--motion-duration-fast]",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-surface-2 text-muted-foreground group-hover:text-foreground",
        )}
      >
        {active ? (
          <Check className="size-3.5" strokeWidth={3} />
        ) : (
          <Icon className="size-3.5" strokeWidth={2} />
        )}
      </span>
      <span className="relative min-w-0">
        <span className="block text-xs font-semibold leading-4 text-foreground">{label}</span>
        <span className="line-clamp-2 block text-[10.5px] leading-[14px] text-muted-foreground">
          {tagline}
        </span>
      </span>
    </motion.button>
  );
}
