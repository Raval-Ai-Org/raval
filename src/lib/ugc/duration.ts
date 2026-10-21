/** Shared output lengths. Provider clip limits remain in the model registry. */
export const DEFAULT_VIDEO_DURATION = 10;
export const MAX_VIDEO_DURATION = 60;
export const VIDEO_DURATION_OPTIONS = [10, 15, 20, 30, 40, 60] as const;

export function outputDurations(native: readonly number[]): number[] {
  return [...new Set([...native, ...VIDEO_DURATION_OPTIONS])].sort((a, b) => a - b);
}

export type VideoSegment = { start: number; seconds: number; renderSeconds: number };

/** Balanced clips, with any unavoidable provider padding trimmed during assembly. */
export function planVideoSegments(seconds: number, native: readonly number[]): VideoSegment[] {
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > MAX_VIDEO_DURATION || !native.length)
    throw new Error("Choose a video length between 4 and 60 seconds.");
  if (native.includes(seconds)) return [{ start: 0, seconds, renderSeconds: seconds }];
  const allowed = [...native].sort((a, b) => a - b);
  const count = Math.ceil(seconds / allowed[allowed.length - 1]);
  const segments: VideoSegment[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const length = Math.ceil((seconds - start) / (count - i));
    segments.push({
      start,
      seconds: length,
      renderSeconds: allowed.find((d) => d >= length)!,
    });
    start += length;
  }
  return segments;
}

/** Conservative Studio quote, shared by the Generate button and its billing hold. */
export function studioVideoUnits(seconds = DEFAULT_VIDEO_DURATION): number {
  return Math.ceil(seconds / DEFAULT_VIDEO_DURATION) * 200;
}

/** Keep only the part of a timed UGC beat sheet belonging to this clip. */
export function segmentVideoPrompt(prompt: string, segment: VideoSegment, total: number): string {
  const end = segment.start + segment.seconds;
  const scoped = prompt
    .split("\n")
    .flatMap((line) => {
      if (segment.start > 0 && line.startsWith("The hook must land")) return [];
      const beat = /^\[([\d.]+)[–-]([\d.]+)s\](.*)$/.exec(line);
      if (!beat) return [line];
      const from = Number(beat[1]);
      const to = Number(beat[2]);
      if (from >= end || to <= segment.start) return [];
      // Split spoken words proportionally when a beat crosses a clip boundary.
      const content = beat[3].replace(/The creator says: "([^"]*)"/, (_, dialogue: string) => {
        const words = dialogue.split(/\s+/);
        const span = Math.max(0.1, to - from);
        const a = Math.round(((Math.max(from, segment.start) - from) / span) * words.length);
        const b = Math.round(((Math.min(to, end) - from) / span) * words.length);
        return `The creator says: "${words.slice(a, b).join(" ")}"`;
      });
      return [
        `[${Math.max(0, from - segment.start)}–${Math.min(segment.seconds, to - segment.start)}s]${content}`,
      ];
    })
    .join("\n");
  return `Create ONLY seconds ${segment.start}–${end} of a ${total}-second video. This clip is ${segment.renderSeconds} seconds. Keep the same creator, clothing, voice, product, lighting and location across the video. ${segment.start === 0 ? "Open with the hook." : "Continue the story; do not repeat the introduction or hook."} ${end === total ? "Finish with the call to action." : "Do not conclude or deliver the final call to action yet."} Fit this section's speech inside the first ${segment.seconds} seconds, then hold naturally.\n\n${scoped}`;
}
