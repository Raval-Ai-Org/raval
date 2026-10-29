import "server-only";

// "Post as is": the person's photo goes out exactly as uploaded, with only
// the real logo drawn on by code when they ask for it. Words or design on a
// photo are a photo design instead (src/lib/studio/photo-design/), never a
// fixed template.
const LOGO_REQUEST = /\b(?:add|put|place|overlay|include|use)\b.{0,40}\b(?:our |the )?logo\b/i;

export function sourcePhotoWantsLogo(brief: string): boolean {
  return LOGO_REQUEST.test(brief);
}
