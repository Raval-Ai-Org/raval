// rendering.ts — decides when a page's raw HTML can't be trusted to represent
// what visitors see, so the worker renders it in a controlled browser.
// HTTP first, always: rendering is the exception for client-rendered shells.
//
// Pure. The browser itself lives in src/server/geo/render.server.ts.

import type { PageAnalysis } from "./types";

export type RenderDecision = {
  render: boolean;
  reason: string;
  /** Framework / shell markers found in the HTML. */
  markers: string[];
};

/** Below this many words of server HTML a page with an app shell is rendered. */
export const RENDER_WORD_THRESHOLD = 150;

const MARKERS: [name: string, pattern: RegExp][] = [
  ["react-root", /<div[^>]+id=["'](root|app-root|__root)["'][^>]*>\s*<\/div>/i],
  ["vue-app", /<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i],
  ["angular", /<app-root[\s>]|\bng-version=/i],
  ["nuxt", /window\.__NUXT__|id=["']__nuxt["']/i],
  ["next", /id=["']__next["']|__NEXT_DATA__|self\.__next_f/i],
  ["svelte", /data-svelte-h=|__sveltekit_/i],
  ["gatsby", /id=["']___gatsby["']/i],
  ["vite-module", /<script[^>]+type=["']module["'][^>]+src=["'][^"']*\/(assets|src)\//i],
  ["noscript-js-required", /<noscript>[^<]{0,200}(enable|requires?|need)[^<]{0,40}javascript/i],
];

export function detectShellMarkers(html: string): string[] {
  const head = html.slice(0, 400_000);
  return MARKERS.filter(([, re]) => re.test(head)).map(([name]) => name);
}

export function needsRendering(
  html: string,
  analysis: Pick<PageAnalysis, "text" | "pageType"> | null,
): RenderDecision {
  const markers = detectShellMarkers(html);
  const words = analysis?.text.words ?? 0;
  if (!analysis) return { render: false, reason: "No HTML analysis to compare", markers };
  if (words >= RENDER_WORD_THRESHOLD) {
    return { render: false, reason: `${words} words already in the server HTML`, markers };
  }
  // Short pages with no app shell (a real, small page) aren't rendered.
  const shell = markers.filter((m) => m !== "next");
  if (!shell.length && !(markers.includes("next") && words < 30)) {
    return { render: false, reason: "Short page without a client-rendered app shell", markers };
  }
  return {
    render: true,
    reason: `Only ${words} words in the server HTML and a client-rendered shell (${markers.join(", ")})`,
    markers,
  };
}
