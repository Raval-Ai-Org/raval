// What a Pin must be before anyone approves it. Pure and browser-safe.
//
// Mellox sends a Pin with exactly one picture (`planPublish` in
// composio/requests.ts refuses anything else), so a video, a Story, a
// carousel or words alone are stopped here, with a plain reason, instead of
// failing at send time after a person approved them.

type PinCandidate = {
  kind?: string | null;
  channel?: string | null;
  media_url?: string | null;
  meta?: Record<string, unknown> | null;
};

export function isPinterestItem(item: PinCandidate): boolean {
  const platform = item.meta?.platform ?? item.channel;
  return platform === "pinterest";
}

function pictureCount(item: PinCandidate): number {
  const many = item.meta?.asset_storage_paths;
  if (Array.isArray(many) && many.length > 1) return many.length;
  const one = item.meta?.asset_storage_path;
  if (typeof one === "string" && one) return 1;
  const url = item.media_url ?? item.meta?.image_url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? 1 : 0;
}

/** Why this piece can't go to Pinterest as it is, or null when it can. */
export function pinIssue(item: PinCandidate): string | null {
  if (!isPinterestItem(item)) return null;
  const kind = item.kind ?? "";
  if (kind === "video" || kind === "story" || item.meta?.media_type === "video") {
    return "Pinterest Pins are pictures. Make an image post for Pinterest instead.";
  }
  const pictures = pictureCount(item);
  if (kind === "carousel" || pictures > 1) {
    return "A Pin has one picture. Make an image post for Pinterest instead.";
  }
  if (pictures === 0) return "A Pin needs a picture. Add one before you approve it.";
  return null;
}
