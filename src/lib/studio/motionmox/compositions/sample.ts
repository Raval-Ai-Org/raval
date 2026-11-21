// Sample data for the composition's defaults and /motionmox-lab. Photos are
// Mellox's own original creator portraits (public/creators), served by the app.
import type { MotionMoxSpec } from "../spec";

export const SAMPLE_SPEC: MotionMoxSpec = {
  version: 1,
  width: 720,
  height: 1280,
  fps: 30,
  segments: [
    {
      kind: "image",
      src: "/creators/amara.jpg",
      seconds: 4,
      focus: { x: 0.5, y: 0.35 },
      zoom: 1.08,
    },
    {
      kind: "image",
      src: "/creators/daniel.jpg",
      seconds: 4,
      focus: { x: 0.5, y: 0.35 },
      zoom: 1.08,
    },
    {
      kind: "image",
      src: "/creators/elena.jpg",
      seconds: 3,
      focus: { x: 0.5, y: 0.4 },
      zoom: 1.04,
    },
  ],
  transition: "slide-left",
  transitionSeconds: 0.5,
  overlay: null,
  texts: [
    { element: "headline", text: "Same-day plumbing", from: 0.3, to: 3.6 },
    { element: "badge", text: "New", from: 0.6, to: 3.4 },
    { element: "price-tag", text: "From Rs 2,500", from: 3.8, to: 6.6 },
    { element: "cta", text: "Book now", from: 6, to: 9.9 },
  ],
  captions: [
    {
      start: 1,
      end: 2.6,
      lines: [
        ["We", "fix", "it"],
        ["the", "same", "day"],
      ],
      emphasis: [1, 2],
    },
  ],
  logo: null,
  progressBar: true,
  look: { ink: "#0b3d2e", paper: "#ffffff", accent: "#f4c430", font: null },
  safe: { x: 0.06, top: 0.08, bottom: 0.12 },
};

/** The sample at another ratio, for the lab. */
export function sampleAt(width: number, height: number): MotionMoxSpec {
  return { ...SAMPLE_SPEC, width, height };
}
