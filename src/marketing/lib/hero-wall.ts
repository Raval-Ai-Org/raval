// The cards on the arc under the home hero: content made with Mellox, playing by itself.
//
//  - `video`     a vertical video that plays muted on a loop; `poster` is its opening picture, shown until it plays
//  - `carousel`  a multi-picture post that slides through its pictures by itself
//
// Videos are H.264 MP4, 540 px wide, no sound, with the index at the front (so they start before the whole file
// has arrived and play on every phone and browser). Save a new one the same way, with `<name>.webp` beside it.
//
// Every file lives in /public/Home/wall/ and is Mellox's own. Only put work here that Mellox made (or that you
// hold the rights to): this wall presents it as Mellox's.
//
// A video and a picture post take turns round the arc, and neighbours never share a colour or a shape, so the
// wall reads as many brands. The arc needs at least ten cards to wrap round without a gap.

export type WallItem =
  | { kind: "video"; src: string; poster: string }
  /** `ratio` is the pictures' own width / height; the card takes that shape, so nothing is cropped. */
  | { kind: "carousel"; slides: string[]; ratio: number };

const file = (name: string) => `/Home/wall/${name}`;

const video = (name: string): WallItem => ({
  kind: "video",
  src: file(`${name}.mp4`),
  poster: file(`${name}.webp`),
});

/** A post saved as `<name>-1.webp` … `<name>-<count>.webp`. */
const post = (name: string, count: number, ratio: number): WallItem => ({
  kind: "carousel",
  slides: Array.from({ length: count }, (_, i) => file(`${name}-${i + 1}.webp`)),
  ratio,
});

export const WALL: WallItem[] = [
  video("website-losing-customers"),
  post("burger", 6, 3 / 4),
  video("reel-1"),
  post("finance", 6, 1),
  video("skin-fix"),
  post("sunscreen", 6, 13 / 16),
  video("reel-2"),
  post("classes", 6, 1),
  video("logo-motion"),
  post("wallet", 4, 4 / 5),
  video("reel-3"),
  post("build", 6, 1),
  video("reel-4"),
  post("milk", 4, 1),
  {
    kind: "carousel",
    slides: [file("marketing-that-moves.webp"), file("see-the-product.webp")],
    ratio: 3 / 4,
  },
];
