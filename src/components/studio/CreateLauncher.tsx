"use client";

// The one entry point for making something: pick what you're making (Video,
// Picture, Text, Ads), then the format inside it. Standard formats open the
// Studio composer on the description step; the creator video ad opens its own
// studio.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import {
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Sparkles,
  UserCircle2,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { rememberStudioType } from "@/hooks/use-studio";
import { chooseType, openComposer } from "@/lib/studio/session-store";
import {
  STUDIO_FORMATS,
  STUDIO_GROUPS,
  type StudioGroup,
  type StudioType,
} from "@/lib/studio/formats";
import { UGC_ENTRY } from "@/lib/studio/ugc-entry";
import { TypeGlyph } from "./studio-ui";

const GROUP_ICON: Record<StudioGroup, LucideIcon> = {
  video: Video,
  picture: ImageIcon,
  text: MessageSquare,
  ads: Megaphone,
};

/** A real StudioType per group, only to borrow its `--tone` colour. */
const GROUP_TONE_TYPE: Record<StudioGroup, StudioType> = {
  video: "video",
  picture: "image",
  text: "social",
  ads: "ad",
};

type Option =
  | { kind: "studio"; type: StudioType; label: string; tagline: string }
  | { kind: "ugc"; label: string; tagline: string; badge: string };

function optionsFor(group: StudioGroup): Option[] {
  const studio: Option[] = (STUDIO_GROUPS.find((g) => g.id === group)?.types ?? []).map((t) => ({
    kind: "studio",
    type: t,
    label: STUDIO_FORMATS[t].label,
    tagline: STUDIO_FORMATS[t].tagline,
  }));
  if (group !== UGC_ENTRY.group) return studio;
  return [
    { kind: "ugc", label: UGC_ENTRY.label, tagline: UGC_ENTRY.description, badge: UGC_ENTRY.badge },
    ...studio,
  ];
}

const CARD =
  "group relative isolate overflow-hidden rounded-2xl border border-border/80 bg-surface-3 text-left shadow-1 transition-[border-color,box-shadow,translate] duration-[--motion-duration-base] ease-[--motion-ease-emphasized] hover:-translate-y-0.5 hover:border-[hsl(var(--tone)/0.45)] hover:shadow-[0_18px_40px_-20px_hsl(var(--tone)/0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]";

/** A soft wash of the card's colour that fades in on hover. */
const GLOW = (
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--tone)/0.14),transparent_60%)] opacity-0 transition-opacity duration-[--motion-duration-slow] group-hover:opacity-100"
  />
);

export function CreateLauncher() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<StudioGroup | null>(null);
  /** 1 = moving into a category, -1 = back out; drives the slide direction. */
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const onOpen = () => {
      setDirection(1);
      setGroupId(null);
      setOpen(true);
    };
    addAppEventListener("open:create-launcher", onOpen);
    return () => removeAppEventListener("open:create-launcher", onOpen);
  }, []);

  const enter = (id: StudioGroup) => {
    setDirection(1);
    setGroupId(id);
  };
  const back = () => {
    setDirection(-1);
    setGroupId(null);
  };

  const pick = (option: Option) => {
    if (option.kind === "ugc") {
      setOpen(false);
      emitAppEvent("open:ugc-studio");
      return;
    }
    rememberStudioType(option.type);
    const id = openComposer({ type: option.type });
    if (!id) return; // openComposer already explained why (e.g. no workspace)
    chooseType(id, option.type);
    setOpen(false);
  };

  const group = STUDIO_GROUPS.find((g) => g.id === groupId) ?? null;
  const slide = reduce ? 0 : 28;
  const panel = {
    initial: (d: number) => ({ opacity: 0, x: d * slide }),
    animate: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: -d * slide, transition: { duration: duration.fast } }),
  };
  const item = (i: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.04 + i * 0.045, duration: duration.medium, ease: ease.emphasized },
  });

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="sm"
      Icon={group ? GROUP_ICON[group.id] : Sparkles}
      title={group ? group.label : "Create"}
      description={group ? "Choose a format" : "What would you like to make?"}
      srDescription="Choose what to make, then pick a format."
      headerAccessory={
        group ? (
          <button
            type="button"
            onClick={back}
            aria-label="Back to all categories"
            className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>
        ) : null
      }
      bodyClassName="overflow-x-hidden p-4 sm:p-5"
    >
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        {!group ? (
          <motion.div
            key="categories"
            custom={direction}
            variants={panel}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: duration.medium, ease: ease.emphasized }}
            className="grid grid-cols-2 gap-3"
          >
            {STUDIO_GROUPS.map((g, i) => {
              const Icon = GROUP_ICON[g.id];
              const options = optionsFor(g.id);
              const summary =
                options.length === 1 ? options[0].tagline : options.map((o) => o.label).join(" · ");
              return (
                <motion.button
                  key={g.id}
                  type="button"
                  {...item(i)}
                  whileTap={reduce ? undefined : { scale: 0.98 }}
                  onClick={() => enter(g.id)}
                  className={cn(`studio-tone-${GROUP_TONE_TYPE[g.id]}`, CARD, "flex flex-col p-4")}
                >
                  {GLOW}
                  <span className="flex items-start justify-between">
                    <span className="studio-glyph grid size-12 place-items-center rounded-2xl transition-transform duration-[--motion-duration-slow] ease-[--motion-ease-spring] group-hover:-rotate-6 group-hover:scale-110">
                      <Icon className="size-[22px]" />
                    </span>
                    <ArrowRight className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-[--motion-duration-base] group-hover:translate-x-0 group-hover:opacity-100" />
                  </span>
                  <span className="mt-5 text-[15px] font-semibold tracking-tight text-foreground">
                    {g.label}
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {summary}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <motion.ul
            key={group.id}
            custom={direction}
            variants={panel}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: duration.medium, ease: ease.emphasized }}
            className="grid gap-2.5"
          >
            {optionsFor(group.id).map((o, i) => (
              <motion.li key={o.kind === "ugc" ? "ugc" : o.type} {...item(i)}>
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className={cn(
                    o.kind === "ugc" ? "studio-tone-ugc" : `studio-tone-${o.type}`,
                    CARD,
                    "flex w-full items-center gap-3.5 p-3.5",
                  )}
                >
                  {GLOW}
                  {o.kind === "ugc" ? (
                    <span className="studio-glyph grid size-11 shrink-0 place-items-center rounded-xl">
                      <UserCircle2 className="size-5" />
                    </span>
                  ) : (
                    <TypeGlyph type={o.type} className="size-11 rounded-xl [&_svg]:size-5" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {o.label}
                      {o.kind === "ugc" ? (
                        <span className="rounded-full bg-[hsl(var(--tone)/0.14)] px-1.5 py-px text-[10px] font-semibold text-[hsl(var(--tone))] ring-1 ring-[hsl(var(--tone)/0.3)]">
                          {o.badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {o.tagline}
                    </span>
                  </span>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground transition-colors duration-[--motion-duration-base] group-hover:bg-[hsl(var(--tone))] group-hover:text-white">
                    <ArrowRight className="size-4 transition-transform duration-[--motion-duration-base] group-hover:translate-x-0.5" />
                  </span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </AppModalShell>
  );
}
