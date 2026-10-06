"use client";

// Autopilot, as the calendar's side panel shows it: is it on, what waits for a
// person, and what is coming up. Presentational — it starts nothing by itself;
// every button is a person's click handed to the caller.

import { ArrowRight, Loader2, Pause, Play } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { MODE_INFO, type ActionView, type AutopilotView } from "@/lib/autopilot/contracts";
import { pauseReasonText } from "@/lib/autopilot/status";
import { dayLabel, pieceLabel, StatusPill } from "@/components/app/autopilot/autopilot-ui";
import { AutopilotOrb } from "@/components/app/autopilot/composer/AutopilotDeck";
import type { Section } from "@/components/app/autopilot/AutopilotScreen";

const SHOWN = 6;

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Notice({
  children,
  action,
  tone = "neutral",
}: {
  children: React.ReactNode;
  action: React.ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-[12.5px]",
        tone === "warn" ? "bg-warning/10" : "bg-[var(--ds-well-bg)]",
      )}
    >
      <span className="min-w-0 font-medium">{children}</span>
      <span className="shrink-0">{action}</span>
    </div>
  );
}

export function AutopilotRail({
  view,
  busy,
  onApprovePlan,
  onPause,
  onOpen,
  onPickAction,
}: {
  view: AutopilotView;
  /** A button on this panel is working. */
  busy: boolean;
  onApprovePlan: () => void;
  onPause: (paused: boolean) => void;
  onOpen: (section: Section) => void;
  /** Show this piece on the calendar. */
  onPickAction: (action: ActionView) => void;
}) {
  const program = view.program;
  if (!program) return null;
  const paused = program.status === "paused";
  const coming = [...view.proposed, ...view.upcoming]
    .filter((a) => a.kind === "content" && a.plannedFor)
    .sort((a, b) => (a.plannedFor ?? "").localeCompare(b.plannedFor ?? ""));
  const waiting = view.approvals.length;
  const failed = view.failed.length;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <AutopilotOrb state={paused ? "paused" : "on"} size={38} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {paused ? "Autopilot is paused" : "Autopilot is on"}
          </div>
          <div className="text-[11.5px] leading-snug text-muted-foreground">
            {paused
              ? pauseReasonText(program.pauseReason)
              : `Week ${program.week} of ${program.totalWeeks} · ${MODE_INFO[program.mode].label}`}
          </div>
        </div>
        {view.canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPause(!paused)}
            className={cn(dsGhostBtn, "h-8 shrink-0 px-3 text-[12px]")}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>

      {view.proposed.length > 0 && (
        <Notice
          action={
            view.canEdit ? (
              <Button size="sm" disabled={busy} onClick={onApprovePlan}>
                {busy && <Loader2 className="animate-spin" />} Approve plan
              </Button>
            ) : null
          }
        >
          This week&apos;s plan is ready
        </Notice>
      )}
      {waiting > 0 && (
        <Notice
          tone="warn"
          action={
            <button
              type="button"
              onClick={() => onOpen("approvals")}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            >
              Review
            </button>
          }
        >
          {waiting} {waiting === 1 ? "post waits" : "posts wait"} for your OK
        </Notice>
      )}
      {failed > 0 && (
        <Notice
          tone="warn"
          action={
            <button
              type="button"
              onClick={() => onOpen("activity")}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            >
              See why
            </button>
          }
        >
          {failed} {failed === 1 ? "post" : "posts"} didn&apos;t go out
        </Notice>
      )}

      <div>
        <div className="ds-label mb-1.5">Coming up</div>
        {coming.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
            {paused ? "Nothing is planned while it is paused" : "The next plan is being written"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {coming.slice(0, SHOWN).map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  onClick={() => onPickAction(action)}
                  className="ds-tile ds-tile-hover block w-full p-2.5 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] text-muted-foreground">
                      {dayLabel(action.plannedFor)} · {timeOf(action.plannedFor)}
                    </span>
                    <StatusPill status={action.status} />
                  </span>
                  <span className="mt-1 block truncate text-[12.5px] font-medium">
                    {action.title || "Planned post"}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {pieceLabel(action)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {coming.length > SHOWN && (
          <p className="mt-1.5 px-1 text-[11.5px] text-muted-foreground">
            +{coming.length - SHOWN} more on the calendar
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpen("home")}
        className={cn(dsGhostBtn, "h-9 w-full px-3 text-[12.5px]")}
      >
        Open Autopilot <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
