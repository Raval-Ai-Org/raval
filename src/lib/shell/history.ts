// Browser history for the shell: Back is always one step out.
//
// Closing a window that is a page of its own (Brain, Inspo, Campaigns…) used
// to *push* Home, and every sidebar hop pushed too, so the browser's Back
// walked through every window ever opened (10–15 presses to leave). Now:
//   - closing a routed window goes back one entry when the entry before it is
//     ours, and only replaces with Home when the window was a direct landing;
//   - a sidebar hop from one section to another replaces the entry, so the
//     history stays "Home → the place you are".
//
// To know whether the entry before is ours, every entry this tab writes is
// stamped with its position (`__mx`) next to Next's own state. Browser-only,
// no React.

const KEY = "__mx";

type Stamped = Record<string, unknown> & { [KEY]?: number };

let installed = false;
let current = 0;
/** The URL (path + search) of each stamped position, as far as this load saw. */
const urls = new Map<number, string>();

function here() {
  return window.location.pathname + window.location.search;
}

function indexOf(state: unknown): number | null {
  const v = (state as Stamped | null)?.[KEY];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stamp(data: unknown, index: number): Stamped {
  return data && typeof data === "object"
    ? { ...(data as Stamped), [KEY]: index }
    : { [KEY]: index };
}

function relative(url: string | URL | null | undefined): string {
  if (url == null) return here();
  try {
    const u = new URL(String(url), window.location.href);
    return u.pathname + u.search;
  } catch {
    return here();
  }
}

/** Mounted once by the shell. Safe to call more than once. */
export function installShellHistory() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const h = window.history;
  const push = h.pushState.bind(h);
  const replace = h.replaceState.bind(h);
  current = indexOf(h.state) ?? 0;
  if (indexOf(h.state) === null) replace(stamp(h.state, current), "", window.location.href);
  urls.set(current, here());

  h.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    current += 1;
    // A push drops every entry after it.
    for (const k of [...urls.keys()]) if (k >= current) urls.delete(k);
    urls.set(current, relative(url));
    return push(stamp(data, current), unused, url);
  };
  h.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    urls.set(current, relative(url));
    return replace(stamp(data, current), unused, url);
  };
  window.addEventListener("popstate", (event) => {
    current = indexOf(event.state) ?? 0;
    urls.set(current, here());
  });
}

/** Whether the entry before this one is the app's own. */
export function canStepBack(): boolean {
  return installed && current > 0;
}

/** The address of the entry before this one, when this load saw it. */
export function previousUrl(): string | null {
  return canStepBack() ? (urls.get(current - 1) ?? null) : null;
}

type Router = { back: () => void; replace: (href: string) => void };

/**
 * Go to `href` inside a window: when it is exactly the entry before (out of a
 * campaign back to the list, say), step back instead of stacking it again.
 */
export function stepTo(
  router: { back: () => void; push: (href: string, opts?: { scroll?: boolean }) => void },
  href: string,
) {
  if (previousUrl() === href) router.back();
  else router.push(href, { scroll: false });
}

/**
 * Leave a routed window: one step back when there is an entry of ours to go
 * back to, else replace it with `fallback` (Home). Never pushes.
 */
export function leaveRoute(router: Router, fallback: string) {
  if (canStepBack()) router.back();
  else router.replace(fallback);
}
