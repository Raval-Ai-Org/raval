// Inspo's board and media shelf (ADR-0037): the brand's visual references as
// cards. Pure: it only reshapes rows that exist (`brand_visual_sources`).

import type { VisualSource } from "@/lib/brand-visuals/contracts";
import { lifetimeOf, type MediaLifetime } from "./media-rotation";

/** The one chip a card wears. "like" covers the stored `style` and `inspiration`. */
export type InspoChip = "like" | "avoid" | "product" | "person" | "element";
export type InspoShelf = "board" | "media";

export const CHIPS: Record<InspoChip, { label: string; shelf: InspoShelf }> = {
  like: { label: "Love", shelf: "board" },
  avoid: { label: "Avoid", shelf: "board" },
  product: { label: "Product", shelf: "media" },
  person: { label: "Person", shelf: "media" },
  element: { label: "Site art", shelf: "media" },
};
export const BOARD_CHIPS: InspoChip[] = ["like", "avoid"];
export const MEDIA_CHIPS: InspoChip[] = ["product", "person", "element"];

export function chipOf(purpose: VisualSource["purpose"]): InspoChip {
  if (purpose === "avoid" || purpose === "product" || purpose === "person" || purpose === "element")
    return purpose;
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
  /** Own media: kept always, or used a couple of times while fresh (media-rotation.ts). */
  lifetime: MediaLifetime;
  /** Inspo → Media folder, or null. */
  folder: string | null;
  /** A full-page capture of the brand's own website (shown under Media → Website). */
  capture: boolean;
  /**
   * A screenshot of the brand's own website (the whole page, its hero, a
   * section or an artwork crop): shown on the Board as "Your website's
   * design", the design every picture follows with the Custom look.
   */
  siteShot: boolean;
  /** Site art: the address of the picture on the brand's site. */
  sourceUrl: string | null;
};

const SHOT_TYPES = new Set(["full", "section", "art"]);

// A video upload also saves still frames named "<label> · 1.2s".
const FRAME_LABEL = /^(.*) · \d+(?:\.\d+)?s$/;

/**
 * Visible cards, newest first. Removed rows and video frames are hidden;
 * full-page captures of the brand's own site show under Media → Website.
 */
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
    .filter(
      (s) =>
        s.kind !== "website" ||
        s.status === "approved" ||
        s.region.type === "full" ||
        // The desktop screenshots of the site's own pages show on the Board.
        (SHOT_TYPES.has(String(s.region.type)) && !s.region.mobile),
    )
    .map((s): InspoCard => {
      const capture = s.kind === "website" && s.region.type === "full";
      const siteShot = s.kind === "website" && SHOT_TYPES.has(String(s.region.type));
      const elementUrl = (s.region as { url?: unknown } | null)?.url;
      const chip = chipOf(s.purpose);
      const video = !!s.asset?.mime_type.startsWith("video/");
      const folder = (s.region as { folder?: unknown } | null)?.folder;
      return {
        id: s.id,
        assetId: s.asset_id,
        chip,
        // A capture of the brand's own site is media, not a mood reference;
        // its section and artwork crops are the Board's "Your website" strip.
        shelf: capture ? "media" : siteShot ? "board" : CHIPS[chip].shelf,
        kind: video ? "video" : "image",
        label: s.label,
        notes: s.notes,
        url: s.asset?.url ?? null,
        thumbUrl: (video ? null : s.asset?.thumbnailUrl) || s.asset?.url || null,
        fromSite: s.kind === "website",
        frameIds: frameIds.get(s.id) ?? [],
        createdAt: s.created_at,
        lifetime: lifetimeOf(s),
        folder: typeof folder === "string" && folder.trim() ? folder.trim() : null,
        capture,
        siteShot,
        sourceUrl: typeof elementUrl === "string" ? elementUrl : null,
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

/**
 * "Use in a post": own photos are designed around; site art (a character, an
 * illustration) is drawn into a new picture in the brand's world; everything
 * else only inspires.
 */
export function studioReferenceMode(chip: InspoChip): "design" | "inspire" | null {
  if (chip === "avoid") return null;
  return chip === "product" || chip === "person" ? "design" : "inspire";
}

/** The Board's "Your website's design" strip: the whole page first, then hero, sections, artwork. */
export function siteDesignCards(cards: InspoCard[]): InspoCard[] {
  const rank = (c: InspoCard) =>
    c.capture ? 0 : /hero/i.test(c.label) ? 1 : /artwork/i.test(c.label) ? 2 : 3;
  return cards
    .filter((c) => c.siteShot && !/mobile/i.test(c.label))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 8);
}
