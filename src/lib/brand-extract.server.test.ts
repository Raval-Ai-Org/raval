import { describe, expect, it, vi } from "vitest";
import { archiveUrl, looksLikeBlockPage, readSitePage } from "./brand-extract.server";

const PAGE = `<html><head><title>Brand</title></head><body>${"Real copy. ".repeat(50)}</body></html>`;
const WALL = "<html><body><h1>Access Denied</h1>You don't have permission.</body></html>";

type Opts = { headers?: Record<string, string> };
const fetcher = (answer: (url: string, ua: string) => string) =>
  vi.fn(async (url: string | URL, opts: Opts = {}) =>
    answer(String(url), opts.headers?.["User-Agent"] ?? ""),
  );

describe("looksLikeBlockPage", () => {
  it("treats empty and bot-wall pages as blocked, real pages as readable", () => {
    expect(looksLikeBlockPage("")).toBe(true);
    expect(looksLikeBlockPage(WALL)).toBe(true);
    expect(looksLikeBlockPage(PAGE)).toBe(false);
    // A big page that merely mentions a captcha is a real page.
    expect(looksLikeBlockPage(`${PAGE.repeat(60)} captcha`)).toBe(false);
  });
});

describe("readSitePage", () => {
  it("reads a normal site directly, once", async () => {
    const f = fetcher(() => PAGE);
    const read = await readSitePage("https://a.com/", { archive: true }, f as never);
    expect(read).toEqual({ html: PAGE, via: "direct" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("always reads as MelloxBrandBot, never as a disguised browser", async () => {
    const f = fetcher(() => "");
    await readSitePage("https://a.com/", { archive: true }, f as never);
    for (const call of f.mock.calls)
      expect((call[1] as Opts).headers?.["User-Agent"]).toContain("MelloxBrandBot");
  });

  it("falls back to the archive when every direct read is a wall (dove.com)", async () => {
    const f = fetcher((url) => (url.startsWith("https://web.archive.org/") ? PAGE : WALL));
    const read = await readSitePage("https://www.dove.com/", { archive: true }, f as never);
    expect(read).toEqual({ html: PAGE, via: "archive" });
    expect(f).toHaveBeenLastCalledWith(archiveUrl("https://www.dove.com/"), expect.anything());
  });

  it("does not use the archive unless asked", async () => {
    const f = fetcher(() => "");
    const read = await readSitePage("https://a.com/x", {}, f as never);
    expect(read).toEqual({ html: "", via: "none" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("keeps a short page that only looked like a wall when nothing better exists", async () => {
    const small = "<html><body>Contact us (protected by reCAPTCHA)</body></html>";
    const f = fetcher((url) => (url.startsWith("https://web.archive.org/") ? "" : small));
    const read = await readSitePage("https://a.com/contact", { archive: true }, f as never);
    expect(read).toEqual({ html: small, via: "direct" });
  });

  it("skips direct reads for a site already known to block", async () => {
    const f = fetcher(() => PAGE);
    const read = await readSitePage(
      "https://a.com/about",
      { archive: true, skipDirect: true },
      f as never,
    );
    expect(read.via).toBe("archive");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
