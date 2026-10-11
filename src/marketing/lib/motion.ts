// The public site is fully animated for every visitor: phones, tablets, laptops, any browser, and whatever the
// system's "reduce motion" setting says. Nothing here or in the marketing CSS switches an animation off, and
// src/styles.css leaves #marketing-root out of the app's reduced-motion rules. Do not add a "static site" gate back.

/** Always false: no visitor gets a static site. Kept so the components that asked keep one place to ask. */
export function prefersStaticMotion(): boolean {
  return false;
}

/** Phones and tablets. Only for input differences (native touch scrolling), never to drop an animation. */
export function isTouchFirst(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse), (hover: none)").matches;
}
