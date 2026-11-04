"use client";

// The workspace sidebar rows (src/lib/shell/nav.ts), Holo style: a tiny group
// label over compact rows; the active row is a white pill that slides between
// rows. `collapsed` draws the same list as an icon rail.

import { motion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Calendar as CalendarIcon,
  Home,
  Megaphone,
  MessageCircle,
  Palette,
  Rocket,
  Share2,
  Sparkles,
  Trophy,
  Users,
  type LucideIcon,
} from "@/components/icons";
import { BrainIcon } from "@/components/app/brain/BrainMark";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { NAV_GROUPS, type NavIcon, type NavItem } from "@/lib/shell/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  chat: MessageCircle,
  // The four-brain mark, drawn at the row's icon size.
  brain: ((p: { className?: string }) => (
    <BrainIcon className={p.className} size={16} />
  )) as unknown as LucideIcon,
  inspo: Palette,
  library: BookOpen,
  campaigns: Megaphone,
  calendar: CalendarIcon,
  analytics: BarChart3,
  visibility: Sparkles,
  communities: Users,
  experiments: Trophy,
  share: Share2,
  portal: Rocket,
};

export function SidebarNav({
  activeId,
  collapsed = false,
  lockFor,
  hintFor,
  showFlag,
  onPick,
}: {
  activeId: string | null;
  collapsed?: boolean;
  /** The plan a locked row needs, or null when it is open. */
  lockFor: (item: NavItem) => PlanId | null;
  hintFor?: (item: NavItem) => string | undefined;
  showFlag: (flag: NonNullable<NavItem["flag"]>) => boolean;
  onPick: (item: NavItem, lockedPlan: PlanId | null) => void;
}) {
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.flag || showFlag(i.flag)) && (!collapsed || i.rail)),
  })).filter((g) => g.items.length > 0);

  if (collapsed) {
    return (
      <nav aria-label="Workspace" className="flex flex-col items-center gap-1">
        {groups
          .flatMap((g) => g.items)
          .map((item) => {
            const Icon = ICONS[item.icon];
            const active = activeId === item.id;
            const lock = lockFor(item);
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-tour={item.tour}
                    onClick={() => onPick(item, lock)}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative grid h-10 w-10 place-items-center rounded-full text-foreground/60 transition-all hover:bg-[var(--ds-well-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      active &&
                        "bg-[var(--ds-card-bg)] text-foreground shadow-[var(--ds-card-shadow)]",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
      </nav>
    );
  }

  return (
    <nav aria-label="Workspace" className="flex flex-col gap-3.5">
      {groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label}>
          <p
            aria-hidden
            className="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.02em] text-muted-foreground/75"
          >
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = activeId === item.id;
              const lock = lockFor(item);
              const hint = hintFor?.(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-tour={item.tour}
                  onClick={() => onPick(item, lock)}
                  aria-current={active ? "page" : undefined}
                  aria-label={
                    lock ? `${item.label} (needs the ${PLANS[lock].label} plan)` : undefined
                  }
                  className={cn(
                    "group relative flex h-8 w-full items-center gap-2.5 rounded-full px-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    active
                      ? "font-semibold text-foreground"
                      : "text-foreground/70 hover:text-foreground",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="sidebar-active"
                      aria-hidden
                      className="absolute inset-0 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]"
                      transition={{ type: "spring", stiffness: 480, damping: 38 }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full bg-[var(--ds-well-bg)] opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  )}
                  <Icon
                    className={cn(
                      "relative h-4 w-4 shrink-0 transition-colors",
                      active
                        ? "text-[var(--mox-green-deep)] dark:text-[var(--mox-lime)]"
                        : "text-foreground/55 group-hover:text-foreground/80",
                    )}
                    strokeWidth={1.9}
                    aria-hidden
                  />
                  <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
                  {lock ? (
                    <span className="relative">
                      <PlanLock plan={lock} />
                    </span>
                  ) : (
                    hint && (
                      <span className="relative rounded-full bg-[var(--mox-lime)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--mox-ink)]">
                        {hint}
                      </span>
                    )
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
