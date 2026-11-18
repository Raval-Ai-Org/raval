// working-files.ts — assets Mellox saves while it makes a piece, which are not
// pieces of their own. Pure and browser-safe.
//
// A carousel's slides, a Story's frames, the first render kept before a
// quality redo, a design layer, a contact sheet, the frames a video check
// looked at, a product cut-out: each belongs to a post (shown as that post) or
// is internal. Listed as media they made one Story look like three and one
// post look like two. They are kept in storage (the post, the redo and the
// publisher read them); they are only left out of the person's media list.

export const WORKING_FILE_SOURCES: ReadonlySet<string> = new Set([
  "studio-carousel",
  "studio-story",
  "studio_review_first",
  "studio_photo_design_layer",
  "studio_photo_design_sheet",
  "visual_composition_background",
  "visual_reference",
  "visual_video_frame",
  "video_review_frame",
  "video_chain_frame",
  "video_first_frame",
  "video_last_frame",
  "product-cutout",
  "ugc-storyboard",
]);

/** True for an asset that is part of making something, not a piece of its own. */
export function isWorkingFile(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const source = (metadata as { source?: unknown }).source;
  return typeof source === "string" && WORKING_FILE_SOURCES.has(source);
}
