"use client";

// The next eight weeks at a glance: one lane per campaign with its phases and
// pieces, and a lane for Autopilot's everyday posts, so a person sees
// everything that's planned in one place. Scrolls sideways inside its own box
// on a narrow screen; the page never does.
import { motion, useReducedMotion } from "framer-motion";
import { addDaysYmd, daysBetweenYmd } from "@/lib/autopilot/time";
import type { CampaignView, CampaignsHome } from "@/lib/campaigns/contracts";
import { playbookById } from "@/lib/campaigns/playbooks";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { kindIcon, shortDate } from "./kit";

const DAYS = 56;

export function Timeline({
  campaigns,
  everyday,
  today,
  autopilotRunning,
  onOpen,
}: {
  campaigns: CampaignView[];
  everyday: CampaignsHome["everyday"];
  today: string;
  autopilotRunning: boolean;
  onOpen(id: string): void;
}) {
  const reduce = useReducedMotion();
  const end = addDaysYmd(today, DAYS - 1);
  const lanes = campaigns
    .filter(
      (c) => c.status !== "ended" && c.status !== "done" && c.endsOn >= today && c.startsOn <= end,
    )
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const pos = (d: string) => Math.max(0, Math.min(DAYS, daysBetweenYmd(today, d)));
  const pct = (d: string) => `${(pos(d) / DAYS) * 100}%`;
  const weeks = Array.from({ length: 8 }, (_, i) => addDaysYmd(today, i * 7));
  const daily = everyday.filter((e) => e.date >= today && e.date <= end);

  return (
    <div className="ds-tile overflow-hidden p-0">
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <div className="min-w-[640px] px-4 pb-4 pt-3">
          {/* Week marks */}
          <div className="relative ml-[148px] h-6 text-[10.5px] font-medium text-muted-foreground">
            {weeks.map((w, i) => (
              <span
                key={w}
                className="absolute top-0 -translate-x-0"
                style={{ left: `${(i * 7 * 100) / DAYS}%` }}
              >
                {i === 0 ? "This week" : shortDate(w).replace(/^\w+ /, "")}
              </span>
            ))}
          </div>

          <div className="relative">
            {/* Week lines and today */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-[148px] right-0"
            >
              {weeks.map((w, i) => (
                <span
                  key={w}
                  className="absolute inset-y-0 w-px bg-border/50"
                  style={{ left: `${(i * 7 * 100) / DAYS}%` }}
                />
              ))}
              <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]" />
            </div>

            <ul className="relative space-y-2">
              {lanes.map((c, i) => {
                const Icon = kindIcon(playbookById(c.type)?.icon);
                const from = c.startsOn < today ? today : c.startsOn;
                const left = pos(from);
                const width = Math.max(1, pos(addDaysYmd(c.endsOn, 1)) - left);
                const paused = c.status === "paused";
                return (
                  <li key={c.id} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onOpen(c.id)}
                      className="flex w-[136px] shrink-0 items-center gap-2 rounded-full text-left text-[12px] font-medium text-foreground/85 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="truncate">{c.name}</span>
                    </button>
                    <div className="relative h-8 min-w-0 flex-1">
                      <motion.button
                        type="button"
                        onClick={() => onOpen(c.id)}
                        aria-label={`Open ${c.name}`}
                        className={cn(
                          "absolute inset-y-0 flex origin-left overflow-hidden rounded-full ring-1 transition-shadow hover:shadow-[0_6px_20px_-10px_hsl(var(--primary)/0.8)]",
                          paused ? "ring-border/70" : "ring-primary/30",
                        )}
                        style={{
                          left: `${(left / DAYS) * 100}%`,
                          width: `${(width / DAYS) * 100}%`,
                        }}
                        initial={reduce ? false : { scaleX: 0, opacity: 0 }}
                        animate={{ scaleX: 1, opacity: 1 }}
                        transition={{
                          duration: duration.xslow,
                          ease: ease.emphasized,
                          delay: i * 0.06,
                        }}
                      >
                        {c.plan.phases
                          .filter((p) => p.endsOn >= from && p.startsOn <= end)
                          .map((p, k) => {
                            const ps = p.startsOn < from ? from : p.startsOn;
                            const pw = pos(addDaysYmd(p.endsOn, 1)) - pos(ps);
                            return (
                              <span
                                key={p.id}
                                title={p.label}
                                className={cn(
                                  "h-full truncate border-r border-background/40 px-2 text-[10px] font-semibold leading-8 last:border-r-0",
                                  paused
                                    ? "bg-[var(--ds-well-bg)] text-muted-foreground"
                                    : k % 2
                                      ? "bg-primary/20 text-foreground/80"
                                      : "bg-primary/32 text-foreground/90",
                                )}
                                style={{ width: `${(pw / width) * 100}%` }}
                              >
                                {p.label}
                              </span>
                            );
                          })}
                      </motion.button>
                      {c.pieces
                        .filter((p) => p.format !== "story" && p.date >= today && p.date <= end)
                        .map((p) => (
                          <span
                            key={p.id}
                            aria-hidden
                            className={cn(
                              "absolute -bottom-1 size-1.5 -translate-x-1/2 rounded-full",
                              p.state === "out" ? "bg-foreground" : "bg-primary",
                            )}
                            style={{ left: `calc(${pct(p.date)} + ${(0.5 / DAYS) * 100}%)` }}
                          />
                        ))}
                    </div>
                  </li>
                );
              })}

              <li className="flex items-center gap-3">
                <span className="flex w-[136px] shrink-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-[11px]">
                    ∞
                  </span>
                  <span className="truncate">Everyday posts</span>
                </span>
                <div className="relative h-8 min-w-0 flex-1 rounded-full bg-[var(--ds-well-bg)]">
                  {daily.map((e, k) => (
                    <span
                      key={`${e.date}-${e.platform}-${k}`}
                      title={`${shortDate(e.date)} · ${e.title}`}
                      className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/45"
                      style={{ left: `calc(${pct(e.date)} + ${(0.5 / DAYS) * 100}%)` }}
                    />
                  ))}
                  {!daily.length && (
                    <span className="absolute inset-0 flex items-center px-3 text-[11px] text-muted-foreground">
                      {autopilotRunning ? "Autopilot fills the free days" : "Autopilot is off"}
                    </span>
                  )}
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
