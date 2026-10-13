import { parseLook } from "@/lib/brand-look/spec";
import type { BrandLook } from "@/lib/brand-look/resolve";
import type { VisualSnapshot } from "./contracts";

/** Explicit Look settings win over inferred website rules. Never changes writing style. */
export function applyVisualTaste(
  base: BrandLook,
  rawLook: unknown,
  snapshot: VisualSnapshot | null,
): BrandLook {
  if (!snapshot) return base;
  const manual = parseLook(rawLook);
  const v = snapshot.direction.visual;
  return {
    ...base,
    customized: true,
    visual: {
      ...base.visual,
      ...v,
      ...manual.visual,
      palette: { ...base.visual.palette, ...v.palette, ...manual.visual?.palette },
      typography: { ...base.visual.typography, ...v.typography, ...manual.visual?.typography },
    },
    video: { ...base.video, ...snapshot.direction.video, ...manual.video },
  };
}
