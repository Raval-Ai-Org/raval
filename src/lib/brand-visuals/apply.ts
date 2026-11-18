import { parseLook } from "@/lib/brand-look/spec";
import type { BrandLook } from "@/lib/brand-look/resolve";
import { CUSTOM_STYLE } from "@/lib/brand-look/picture-styles";
import { ownDesignLine } from "./bible";
import type { VisualSnapshot } from "./contracts";

/**
 * Explicit Look settings win over inferred website rules. Never changes writing style.
 * A brand on auto picture styles with a learned design of its own (a style
 * bible) or saved Inspo references gets Custom: its own look, never a
 * template style on top of it.
 */
export function applyVisualTaste(
  base: BrandLook,
  rawLook: unknown,
  snapshot: VisualSnapshot | null,
): BrandLook {
  if (!snapshot) return base;
  const manual = parseLook(rawLook);
  const v = snapshot.direction.visual;
  const ownDesign =
    base.ownDesign ??
    (snapshot.profileId === "board"
      ? "Follow the design language of the brand's saved Inspo references (layout, type, colour blocks, graphic elements, photo treatment)."
      : ownDesignLine(snapshot.direction));
  return {
    ...base,
    customized: true,
    pictureStyles: base.pictureStyles.auto
      ? { ids: [CUSTOM_STYLE], auto: true }
      : base.pictureStyles,
    ownDesign,
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
