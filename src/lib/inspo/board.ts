// Inspo's board and media shelf (ADR-0037): the brand's visual references as
// cards. Pure: it only reshapes rows that exist (`brand_visual_sources`).

import type { VisualSource } from "@/lib/brand-visuals/contracts";

/** The one chip a card wears. "like" covers the stored `style` and `inspiration`. */
export type InspoChip = "like" | "avoid" | "product" | "person";
export type InspoShelf = "board" | "media";

export const CHIPS: Record<InspoChip, { label: string; shelf: InspoShelf }> = {
  like: { label: "Love", shelf: "board" },
  avoid: { label: "Avoid", shelf: "board" },
  product: { label: "Product", shelf: "media" },
  person: { label: "Person", shelf: "media" },
};
export const BOARD_CHIPS: InspoChip[] = ["like", "avoid"];
export const MEDIA_CHIPS: InspoChip[] = ["product", "person"];

export function chipOf(purpose: VisualSource["purpose"]): InspoChip {
  if (purpose === "avoid" || purpose === "product" || purpose === "person") return purpose;
  return "like";
}

/** The stored purpose for a chip. A "like" keeps `inspiration` if it already was one. */
export function purposeOf(
  chip: InspoChip,
  current?: VisualSource["purpose"],
): VisualSource["purpose"] {
  if (chip === "like") return current === "inspiration" ? "inspiration" : "style";
  return chip;
}

export type InspoCard = {
  id: string;
  assetId: string;
  chip: InspoChip;
  shelf: InspoShelf;
  kind: "image" | "video";
  label: string;
  notes: string;
  url: string | null;
  thumbUrl: string | null;
  fromSite: boolean;
  /** Ids of the still frames a video upload made (removed together with it). */
  frameIds: string[];
  createdAt: string;
};

// A video upload also saves still frames named "<label> · 1.2s".
const FRAME_LABEL = /^(.*) · \d+(?:\.\d+)?s$/;

/** Visible cards, newest first. Removed rows, full-page captures and video frames are hidden. */
export function inspoCards(sources: VisualSource[]): InspoCard[] {
  const live = sources.filter((s) => s.status !== "removed");
  const videos = live.filter((s) => s.asset?.mime_type.startsWith("video/"));
  const frameIds = new Map<string, string[]>();
  const hidden = new Set<string>();
  for (const s of live) {
    const m = s.label.match(FRAME_LABEL);
    if (!m || s.asset?.mime_type.startsWith("video/")) continue;
    const parent = videos.find((v) => v.label === m[1] && v.purpose === s.purpose);
    if (!parent) continue;
    hidden.add(s.id);
    frameIds.set(parent.id, [...(frameIds.get(parent.id) ?? []), s.id]);
  }
  return live
    .filter((s) => !hidden.has(s.id))
    .filter((s) => s.kind !== "website" || (s.status === "approved" && s.region.type !== "full"))
    .map((s): InspoCard => {
      const chip = chipOf(s.purpose);
      const video = !!s.asset?.mime_type.startsWith("video/");
      return {
        id: s.id,
        assetId: s.asset_id,
        chip,
        shelf: CHIPS[chip].shelf,
        kind: video ? "video" : "image",
        label: s.label,
        notes: s.notes,
        url: s.asset?.url ?? null,
        thumbUrl: (video ? null : s.asset?.thumbnailUrl) || s.asset?.url || null,
        fromSite: s.kind === "website",
        frameIds: frameIds.get(s.id) ?? [],
        createdAt: s.created_at,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function shelfCards(cards: InspoCard[], shelf: InspoShelf): InspoCard[] {
  return cards.filter((c) => c.shelf === shelf);
}

/** "Learn my style" needs at least one liked picture (the analysis reads images). */
export function canLearn(cards: InspoCard[]): boolean {
  return cards.some((c) => c.chip !== "avoid" && c.kind === "image");
}

/** "Use in a post": own media is designed around, everything else only inspires. */
export function studioReferenceMode(chip: InspoChip): "design" | "inspire" | null {
  if (chip === "avoid") return null;
  return chip === "product" || chip === "person" ? "design" : "inspire";
}
