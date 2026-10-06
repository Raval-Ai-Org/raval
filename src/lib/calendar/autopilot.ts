// Content Calendar × Autopilot — pure, browser-safe.
//
// A piece Autopilot has already written is a `content_items` row, so it is on
// the calendar like any other post. A piece it has only planned has no row
// yet: those are the "planned slots" drawn here, so the calendar shows the
// whole week Autopilot is working on. A slot is read-only; nothing on the
// calendar can change Autopilot's plan.

import type { ActionView, AutopilotView } from "@/lib/autopilot/contracts";
import { fmtHM, fmtYMD, toCalendarChannel, type CalendarChannel } from "./model";

export type PlannedSlot = {
  id: string;
  date: string; // YYYY-MM-DD, in the viewer's own time zone
  time: string; // HH:mm
  channel: CalendarChannel;
  title: string;
  /** "Post", "Carousel", "Story"… in plain words. */
  format: string;
  /** `proposed` waits for a yes on the plan; `writing` is being made now. */
  state: "proposed" | "planned" | "writing";
};

type Lists = Pick<AutopilotView, "proposed" | "approvals" | "upcoming" | "finished" | "failed">;

const FORMAT: Record<string, string> = {
  social: "Post",
  image: "Image",
  carousel: "Carousel",
  video: "Video",
  article: "Article",
  story: "Story",
};

function slotFrom(action: ActionView): PlannedSlot | null {
  if (action.kind !== "content" || action.contentItemIds.length || !action.plannedFor) return null;
  const at = new Date(action.plannedFor);
  if (Number.isNaN(at.getTime())) return null;
  return {
    id: action.id,
    date: fmtYMD(at),
    time: fmtHM(at),
    channel:
      action.contentType === "article" && !action.platform
        ? "blog"
        : toCalendarChannel(action.platform),
    title: action.title.trim() || "Planned post",
    format: FORMAT[action.contentType ?? ""] ?? "Post",
    state:
      action.status === "proposed"
        ? "proposed"
        : action.status === "generating"
          ? "writing"
          : "planned",
  };
}

/** Pieces Autopilot has planned but not written yet, soonest first. */
export function plannedSlots(view: Pick<Lists, "proposed" | "upcoming">): PlannedSlot[] {
  return [...view.proposed, ...view.upcoming]
    .map(slotFrom)
    .filter((slot): slot is PlannedSlot => slot !== null)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function slotsByDate(slots: PlannedSlot[]): Map<string, PlannedSlot[]> {
  const map = new Map<string, PlannedSlot[]>();
  for (const slot of slots) {
    const list = map.get(slot.date);
    if (list) list.push(slot);
    else map.set(slot.date, [slot]);
  }
  return map;
}

/** Ids of the posts on the calendar that Autopilot made. */
export function autopilotItemIds(view: Lists): Set<string> {
  const ids = new Set<string>();
  for (const list of [view.proposed, view.approvals, view.upcoming, view.finished, view.failed]) {
    for (const action of list) for (const id of action.contentItemIds) ids.add(id);
  }
  return ids;
}

/**
 * Changes whenever Autopilot writes, schedules or sends something, so the
 * calendar knows to read its posts again.
 */
export function autopilotSignature(view: Lists): string {
  return [view.proposed, view.approvals, view.upcoming, view.finished, view.failed]
    .flat()
    .map((a) => `${a.id}:${a.status}:${a.contentItemIds.length}`)
    .sort()
    .join("|");
}
