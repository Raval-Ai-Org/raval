import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A small stand-in for the browser's session history: entries, a position,
// popstate on back. Enough to check what Back does after shell navigation.
function fakeBrowser(start: string) {
  const entries: { url: string; state: unknown }[] = [{ url: start, state: null }];
  let at = 0;
  const pop: ((e: { state: unknown }) => void)[] = [];
  const location = { pathname: "", search: "", href: "" };
  const sync = () => {
    const u = new URL(entries[at].url, "http://app.test");
    location.pathname = u.pathname;
    location.search = u.search;
    location.href = u.href;
  };
  sync();
  const history = {
    get state() {
      return entries[at].state;
    },
    pushState(state: unknown, _u: string, url?: string | URL | null) {
      entries.splice(at + 1);
      entries.push({ url: String(url ?? entries[at].url), state });
      at += 1;
      sync();
    },
    replaceState(state: unknown, _u: string, url?: string | URL | null) {
      entries[at] = { url: String(url ?? entries[at].url), state };
      sync();
    },
    back() {
      if (at === 0) return;
      at -= 1;
      sync();
      pop.forEach((l) => l({ state: entries[at].state }));
    },
  };
  const win = {
    history,
    location,
    addEventListener: (type: string, l: (e: { state: unknown }) => void) => {
      if (type === "popstate") pop.push(l);
    },
  };
  const rel = (url: string) => {
    const u = new URL(url, "http://app.test");
    return u.pathname + u.search;
  };
  return {
    win,
    urls: () => entries.map((e) => rel(e.url)),
    position: () => at,
    current: () => rel(entries[at].url),
  };
}

const HOME = "/w/1/app";
const BRAIN = "/w/1/app/brain";
const INSPO = "/w/1/app/inspo";

let browser: ReturnType<typeof fakeBrowser>;
let mod: typeof import("./history");

beforeEach(async () => {
  vi.resetModules();
  browser = fakeBrowser(HOME);
  vi.stubGlobal("window", browser.win);
  mod = await import("./history");
  mod.installShellHistory();
});
afterEach(() => vi.unstubAllGlobals());

const router = () => ({
  back: () => browser.win.history.back(),
  replace: (href: string) => browser.win.history.replaceState(null, "", href),
  push: (href: string) => browser.win.history.pushState(null, "", href),
});

describe("shell history", () => {
  it("closing a window opened from Home steps back instead of stacking Home", () => {
    router().push(BRAIN);
    expect(mod.previousUrl()).toBe(HOME);
    mod.leaveRoute(router(), HOME);
    expect(browser.current()).toBe(HOME);
    expect(browser.urls()).toEqual([HOME, BRAIN]); // forward entry only
    expect(browser.position()).toBe(0);
    expect(mod.canStepBack()).toBe(false);
  });

  it("a direct landing on a window replaces it with Home", () => {
    browser = fakeBrowser(BRAIN);
    vi.stubGlobal("window", browser.win);
    return import("./history").then(() => {
      // Same module instance is installed already; reload it for this browser.
      vi.resetModules();
      return import("./history").then((fresh) => {
        fresh.installShellHistory();
        fresh.leaveRoute(router(), HOME);
        expect(browser.urls()).toEqual([HOME]);
      });
    });
  });

  it("many open/close rounds never grow the stack", () => {
    for (let i = 0; i < 10; i++) {
      router().push(i % 2 ? BRAIN : INSPO);
      mod.leaveRoute(router(), HOME);
    }
    expect(browser.position()).toBe(0);
    expect(browser.current()).toBe(HOME);
  });

  it("stepTo goes back to the entry just before rather than pushing it again", () => {
    const list = "/w/1/app/campaigns";
    const one = "/w/1/app/campaigns?c=abc";
    router().push(list);
    mod.stepTo(router(), one);
    mod.stepTo(router(), list);
    expect(browser.position()).toBe(1);
    expect(browser.current()).toBe(list);
  });

  it("keeps Next's own state on every entry", () => {
    browser.win.history.pushState({ __NA: true, tree: 1 }, "", BRAIN);
    expect(browser.win.history.state).toMatchObject({ __NA: true, tree: 1, __mx: 1 });
  });
});
