// media-library.ts — the brand's own media as a library: folders, labels and
// which media a brief is about. Pure and browser-safe.
//
// A folder ("Launch event", "Team", "Summer menu") and a label ("Opening night
// at the Lahore store") are a person's words about their own photos. When a
// brief names them ("use the launch event photos", "our team at the expo"),
// the piece is made with those photos (`mediaForBrief`), the way a named
// product is picked by itself. Nothing here invents what a photo shows.

export type LibraryItem = {
  assetId: string;
  kind: "image" | "video";
  folder?: string | null;
  /** The person's words about the photo (Inspo → Media label). */
  label?: string | null;
  /** Fallback words: the file name. */
  name?: string | null;
};

const STOP = new Set(
  "a an and the of to for in on at with our my your their this that these those is are was be it its from by as or we us me i you new use using make post posts photo photos picture pictures pic pics image images video videos clip clips media library inspo folder".split(
    " ",
  ),
);

function words(text: string | null | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})s$/, ""));
}

/** Folder names in use, most items first, then A–Z. */
export function mediaFolders(items: readonly { folder?: string | null }[]): Array<{
  name: string;
  count: number;
}> {
  const counts = new Map<string, number>();
  for (const i of items) {
    const name = i.folder?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Does the brief ask for the person's own media at all ("our photos", "from the event")? */
const MEDIA_CUE =
  /\b(photo|photos|pictures?|pics?|images?|videos?|clips?|footage|shots?|from (?:the|our|my) (?:media|library|inspo|folder|event|launch|shoot))\b/i;

export function briefAsksForOwnMedia(brief: string): boolean {
  return MEDIA_CUE.test(brief ?? "");
}

/**
 * Media a brief is about: a folder whose whole name appears in the brief
 * wins (every item in it); else items whose folder or label shares at least
 * two meaningful words with the brief (or one, for a one-word folder/label).
 * Best matches first, at most `max`. Empty when nothing clearly matches.
 */
export function mediaForBrief(
  items: readonly LibraryItem[],
  brief: string,
  max = 4,
): LibraryItem[] {
  const text = (brief ?? "").toLowerCase();
  const briefWords = new Set(words(brief));
  if (!briefWords.size) return [];

  const folderHit = mediaFolders(items).find(
    (f) => words(f.name).length > 0 && words(f.name).every((w) => briefWords.has(w)),
  );
  if (folderHit) {
    // A folder named outright: its photos, newest wins left to the caller's order.
    return items.filter((i) => i.folder?.trim() === folderHit.name).slice(0, max);
  }

  const scored = items
    .map((item) => {
      const own = new Set([...words(item.folder), ...words(item.label)]);
      if (!own.size) return { item, score: 0 };
      let hits = 0;
      for (const w of own) if (briefWords.has(w)) hits++;
      const need = own.size === 1 ? 1 : 2;
      const exact = item.label && text.includes(item.label.toLowerCase().trim()) ? 2 : 0;
      return { item, score: hits >= need ? hits + exact : exact };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.item);
}

/** A short line per folder for a writer: what the brand has, in its own words. */
export function libraryLines(items: readonly LibraryItem[], maxFolders = 6): string {
  const folders = mediaFolders(items).slice(0, maxFolders);
  const lines = folders.map((f) => {
    const labels = [
      ...new Set(
        items
          .filter((i) => i.folder?.trim() === f.name)
          .map((i) => i.label?.trim())
          .filter((l): l is string => !!l),
      ),
    ].slice(0, 3);
    return `- ${f.name} (${f.count} ${f.count === 1 ? "item" : "items"})${labels.length ? `: ${labels.join("; ")}` : ""}`;
  });
  return lines.join("\n");
}
