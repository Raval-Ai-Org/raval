// Which of the person's own photos and clips goes on which piece. The person
// uploads them once; code places them so the campaign tells its story with the
// real pictures: close-ups for the tease, the hero shot for the reveal, the
// event photos for the recap. Studio composites them (photo design), so they
// are never redrawn.
//
// Also settles formats against what exists: a video piece is only kept when
// there are clips to edit or photos for a recap, so a campaign never turns
// into a row of generated videos by surprise.
// Pure: no I/O.
import type { CampaignMedia, CampaignPiece, MediaRole } from "./contracts";
import { phaseOf, type Playbook } from "./playbooks";

const PHOTOS_PER_FORMAT: Record<string, number> = { image: 1, social: 1, carousel: 3 };
const RECAP_PHOTOS = 6;
const CLIPS_PER_VIDEO = 3;

/** Pictures on Instagram, TikTok and YouTube need media; text posts there get a photo too. */
const PICTURE_PLATFORMS = new Set(["instagram", "tiktok", "youtube"]);

function pool(
  media: readonly CampaignMedia[],
  kind: "image" | "video",
  roles: readonly MediaRole[],
) {
  const ofKind = media.filter((m) => m.kind === kind);
  const matching = ofKind.filter((m) => roles.includes(m.role) || m.role === "any");
  return matching.length ? matching : ofKind;
}

/**
 * Formats that need footage are swapped when there's none: a video becomes the
 * phase's next format that doesn't need it.
 */
export function settleFormats(
  playbook: Playbook,
  pieces: readonly CampaignPiece[],
  media: readonly CampaignMedia[],
): CampaignPiece[] {
  const clips = media.filter((m) => m.kind === "video").length;
  const photos = media.filter((m) => m.kind === "image").length;
  const canVideo = clips > 0 || photos >= 2;
  return pieces.map((piece) => {
    if (piece.format !== "video" || canVideo || piece.edited) return piece;
    const phase = phaseOf(playbook, piece.phase);
    const next = phase.formats.find((f) => f !== "video" && f !== "story") ?? "image";
    return { ...piece, format: next };
  });
}

/**
 * Give each piece the photos or clips that suit its phase, spreading them so
 * every one is used before any repeats and two pieces in a row don't share
 * one. Pieces a person edited keep what they chose.
 */
export function assignMedia(
  playbook: Playbook,
  pieces: readonly CampaignPiece[],
  media: readonly CampaignMedia[],
): CampaignPiece[] {
  if (!media.length) {
    return pieces.map((p) => (p.edited ? p : { ...p, mediaIds: [], mediaMode: "none" }));
  }
  const used = new Map<string, number>();
  let previous = new Set<string>();

  const take = (candidates: CampaignMedia[], n: number): string[] => {
    const ranked = [...candidates].sort(
      (a, b) =>
        (used.get(a.assetId) ?? 0) - (used.get(b.assetId) ?? 0) ||
        Number(previous.has(a.assetId)) - Number(previous.has(b.assetId)),
    );
    const picked = ranked.slice(0, n).map((m) => m.assetId);
    for (const id of picked) used.set(id, (used.get(id) ?? 0) + 1);
    return picked;
  };

  return pieces.map((piece) => {
    if (piece.edited) return piece;
    const roles = phaseOf(playbook, piece.phase).media;
    let mediaIds: string[] = [];
    let mediaMode: CampaignPiece["mediaMode"] = "none";

    if (piece.format === "video") {
      const clips = pool(media, "video", roles);
      if (clips.length) {
        mediaIds = take(clips, CLIPS_PER_VIDEO);
        mediaMode = "clips";
      } else {
        const photos = pool(media, "image", roles);
        if (photos.length >= 2) {
          mediaIds = take(photos, RECAP_PHOTOS);
          mediaMode = "recap";
        }
      }
    } else if (piece.format !== "story") {
      const wantsPicture = piece.format !== "social" || PICTURE_PLATFORMS.has(piece.platform);
      const photos = pool(media, "image", roles);
      if (wantsPicture && photos.length) {
        mediaIds = take(photos, PHOTOS_PER_FORMAT[piece.format] ?? 1);
        mediaMode = "design";
      }
    }
    previous = new Set(mediaIds);
    return { ...piece, mediaIds, mediaMode };
  });
}

/** How often each photo or clip is used, for the media panel. */
export function mediaUse(pieces: readonly CampaignPiece[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const piece of pieces) for (const id of piece.mediaIds) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}
