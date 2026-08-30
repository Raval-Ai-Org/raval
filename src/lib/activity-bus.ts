// Tiny pub/sub bus that ties every module together.
// Modules emit events ("ad scaled", "post scheduled", "agent toggled");
// the chat panel + LiveActivityStream + sonner toasts all subscribe.

import { useEffect, useState } from "react";
import { toast } from "sonner";

export type ActivityKind =
  | "agent.toggle"
  | "agent.mission"
  | "ads.autopilot"
  | "ads.guardrails"
  | "ads.tab"
  | "social.scheduled"
  | "seo.fix"
  | "nav";

export interface BusEvent {
  id: string;
  kind: ActivityKind;
  agentSlug?: string; // seo / content / social / ads / crm / analytics
  title: string;
  detail?: string;
  ts: number;
  toast?: boolean; // surface as a sonner toast
}

const MAX = 40;
let buffer: BusEvent[] = [];
const subs = new Set<(events: BusEvent[]) => void>();

export function emit(ev: Omit<BusEvent, "id" | "ts"> & { id?: string; ts?: number }) {
  const next: BusEvent = {
    id: ev.id ?? crypto.randomUUID(),
    ts: ev.ts ?? Date.now(),
    ...ev,
  };
  buffer = [next, ...buffer].slice(0, MAX);
  subs.forEach((cb) => cb(buffer));
  if (next.toast) {
    toast(next.title, { description: next.detail });
  }
}

export function useActivity() {
  const [events, setEvents] = useState<BusEvent[]>(buffer);
  useEffect(() => {
    const cb = (e: BusEvent[]) => setEvents(e);
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }, []);
  return events;
}
