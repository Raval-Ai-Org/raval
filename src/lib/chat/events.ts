// What a chat reply can carry besides its words (ADR-0033). The server sends
// these as `data: {"mellox": …}` lines in the reply stream; the browser shows
// them under the reply and stores them on the message's `metadata`.
import type { MemoryChange } from "@/lib/memory/contracts";
import { findPlace } from "./places";

/** A change chat prepared. It happens only when a person clicks its button. */
export type ChatActionView = {
  id: string;
  /** "Schedule approved posts" */
  title: string;
  /** What exactly will happen, from the stored request. */
  detail: string;
  /** Removes or publishes something: the button asks once more first. */
  destructive: boolean;
  state: "offered" | "running" | "done" | "failed";
  /** One line shown after it ran, or why it didn't. */
  note?: string;
};

/** A button that opens a place in Mellox (src/lib/chat/places.ts). */
export type ChatPlaceOffer = { place: string; label: string };

/** "Looking at your posts…" while a reply reads the workspace's data. */
export type ChatToolActivity = { label: string; state: "start" | "done" };

export type ChatStreamEvent = {
  truncated?: boolean;
  tool?: ChatToolActivity;
  memory?: MemoryChange[];
  actions?: ChatActionView[];
  offers?: ChatPlaceOffer[];
};

/** What an assistant message keeps beside its text. */
export type ChatReplyExtras = {
  memory?: MemoryChange[];
  actions?: ChatActionView[];
  offers?: ChatPlaceOffer[];
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Read extras back from a stored message. Anything malformed is dropped. */
export function parseReplyExtras(raw: unknown): ChatReplyExtras {
  const meta = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, 8) : []);
  const memory = list(meta.memory)
    .map((item) => item as Record<string, unknown>)
    .filter(
      (m) =>
        m && typeof m.id === "string" && ["added", "updated", "removed"].includes(String(m.op)),
    )
    .map((m) => ({
      op: m.op as MemoryChange["op"],
      id: m.id as string,
      text: text(m.text, 500),
      temporary: m.temporary === true,
    }));
  const actions = list(meta.actions)
    .map((item) => item as Record<string, unknown>)
    .filter((a) => a && typeof a.id === "string" && typeof a.title === "string")
    .map((a) => ({
      id: a.id as string,
      title: text(a.title, 200),
      detail: text(a.detail, 600),
      destructive: a.destructive === true,
      state: (["offered", "running", "done", "failed"].includes(String(a.state))
        ? a.state
        : "offered") as ChatActionView["state"],
      note: text(a.note, 300) || undefined,
    }));
  const offers = list(meta.offers)
    .map((item) => item as Record<string, unknown>)
    .filter((o) => o && !!findPlace(o.place))
    .map((o) => ({ place: o.place as string, label: findPlace(o.place)!.label }));
  return {
    ...(memory.length ? { memory } : {}),
    ...(actions.length ? { actions } : {}),
    ...(offers.length ? { offers } : {}),
  };
}

export function hasExtras(extras: ChatReplyExtras | undefined): boolean {
  return !!(extras?.memory?.length || extras?.actions?.length || extras?.offers?.length);
}
