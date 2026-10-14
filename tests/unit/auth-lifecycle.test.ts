import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCallbackUrl, consumeStoredNextPath, signOutAndRedirect } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), event: vi.fn(), error: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signOut: mocks.signOut } },
}));
vi.mock("@/lib/app-events", () => ({ emitAppEvent: mocks.event }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error } }));

function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const key = "mellox:auth-next";
let local: ReturnType<typeof storage>;
let tab: ReturnType<typeof storage>;
let replace: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  local = storage();
  tab = storage();
  replace = vi.fn();
  vi.stubGlobal("window", {
    localStorage: local,
    sessionStorage: tab,
    location: { origin: "https://mellox.ai", search: "", replace },
  });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("authentication lifecycle", () => {
  it("keeps a tab's destination when local storage is blocked", () => {
    tab.setItem(key, "/invite/abc");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    expect(consumeStoredNextPath()).toBe("/invite/abc");
    expect(tab.getItem(key)).toBeNull();
  });

  it("remembers the cross-tab destination when session storage is blocked", () => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    authCallbackUrl("/invite/abc");
    expect(consumeStoredNextPath()).toBe("/invite/abc");
    expect(local.getItem(key)).toBeNull();
  });

  it.each([Date.now() + 60_000, Date.now() - 86_400_000])(
    "refuses invalid cross-tab timestamps: %s",
    (at) => {
      local.setItem(key, JSON.stringify({ next: "/invite/abc", at }));
      expect(consumeStoredNextPath()).toBe("/projects");
    },
  );

  it("does not redirect or discard account context when sign-out is rejected", async () => {
    local.setItem("studio:sessions:v2", "drafts");
    mocks.signOut.mockResolvedValue({ error: new Error("offline") });
    const cache = { cancelQueries: vi.fn(), clear: vi.fn() };
    expect(await signOutAndRedirect(cache as never)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(cache.clear).not.toHaveBeenCalled();
    expect(local.getItem("studio:sessions:v2")).toBe("drafts");
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it("handles thrown sign-out failures without pretending logout succeeded", async () => {
    mocks.signOut.mockRejectedValue(new Error("network unavailable"));
    expect(await signOutAndRedirect()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("clears account context in both stores and redirects after verified sign-out", async () => {
    for (const store of [local, tab]) {
      for (const name of [
        "workspace:selected",
        "social:connect:pending",
        "brand-dna:ws",
        "studio:sessions:v2",
        key,
      ])
        store.setItem(name, "private");
      store.setItem("mellox:theme", "light");
    }
    const cache = { cancelQueries: vi.fn().mockResolvedValue(undefined), clear: vi.fn() };
    expect(await signOutAndRedirect(cache as never)).toBe(true);
    for (const store of [local, tab]) {
      expect(store.length).toBe(1);
      expect(store.getItem("mellox:theme")).toBe("light");
    }
    expect(cache.cancelQueries).toHaveBeenCalledOnce();
    expect(cache.clear).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("clears session storage even when access to local storage fails", async () => {
    tab.setItem("workspace:selected", "private");
    tab.setItem("studio:image-cache:v1", "private");
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    await signOutAndRedirect();
    expect(tab.length).toBe(0);
    expect(replace).toHaveBeenCalledWith("/");
  });
});
