// color.ts — small, dependency-free helpers for working with brand hex colors.

/** `#abc`, `abc`, `#aabbcc` or `aabbcc` → `#aabbcc`; anything else → null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s))
    return (
      "#" +
      s
        .split("")
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  if (/^[0-9a-f]{6}$/i.test(s)) return "#" + s.toLowerCase();
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Near-black or near-white ink, whichever reads on `bg`. */
export function pickTextOn(bg: string): string {
  return relLuminance(bg) > 0.55 ? "#0A0A0A" : "#FAFAF7";
}
