// image-prompt-fit.ts — keeps the notes a picture must follow inside the image
// model's prompt limit (pure).
//
// The Images API call cuts a prompt at IMAGE_PROMPT_LIMIT characters
// (openrouter-image.server.ts). Studio's built prompts are already close to
// that, so anything appended after them (a revision note, the defects a
// re-render must fix, "no words", the brand's visual rules) used to be cut
// off: people paid for an edit the model never saw. Must-follow notes now go
// first, and only the long body is trimmed to fit.

/** The image gateway's hard cut (openrouter-image.server.ts). */
export const IMAGE_PROMPT_LIMIT = 10_000;

const MUST_HEADER = "MUST FOLLOW (these override anything below):";

/**
 * Must-follow notes first, then the body, together within `limit` characters.
 * The notes are never trimmed below their own length unless they alone exceed
 * the limit; the body loses its end first (its closing checklist repeats
 * rules stated earlier).
 */
export function fitImagePrompt(args: {
  body: string;
  must?: (string | null | undefined | false)[];
  limit?: number;
}): string {
  const limit = args.limit ?? IMAGE_PROMPT_LIMIT;
  const notes = (args.must ?? [])
    .filter((note): note is string => typeof note === "string")
    .map((note) => note.trim())
    .filter(Boolean);
  const body = args.body.trim();
  if (!notes.length) return body.slice(0, limit);
  const head = `${MUST_HEADER}\n${notes.join("\n\n")}`;
  if (head.length >= limit) return head.slice(0, limit);
  const room = limit - head.length - 2;
  return room > 0 ? `${head}\n\n${body.slice(0, room)}` : head;
}
