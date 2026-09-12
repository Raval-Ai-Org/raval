"use client";

/**
 * DEPRECATED — re-exports `@/components/icons`. Import from there instead.
 *
 * This module used to render every icon in the app as a Google Material
 * Symbols *ligature* inside a `<span>`: the element's text content was
 * literally "arrow_back", and a remote font turned it into a glyph. That had
 * four consequences worth remembering, because they are why the file is now
 * three lines:
 *
 *   • The raw word painted on screen until the font loaded (the icon
 *     stylesheet was requested with `display=swap`).
 *   • An unresolvable name silently became a dot — the module measured
 *     `scrollWidth` at runtime to detect the failure and substituted `circle`.
 *   • `strokeWidth` was accepted for API parity and then discarded, so all
 *     fourteen stroke weights used across the app were dead props.
 *   • Sizing was resolved by parsing the className string into four buckets,
 *     so `h-3 w-3` and `h-4 w-4` rendered identically and `w-*` was ignored.
 *
 * It also named the product's icon language after Gemini's. Mellox has its
 * own set now; see `src/components/icons/glyphs.tsx`.
 *
 * Kept as a shim so the ~50 files importing from here keep working while
 * their imports migrate.
 */

export * from "@/components/icons";
