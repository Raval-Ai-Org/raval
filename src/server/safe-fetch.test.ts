import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupAddress } from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPublicUrl,
  createSafeFetch,
  isBlockedAddress,
  ResponseTooLargeError,
  SsrfBlockedError,
} from "./safe-fetch";

// Every test hostname resolves to the local test server. With the real address
// policy that must be refused at connect time; with an allow-all policy it lets
// us exercise redirects and byte caps against a real socket.
const fakeLookup = ((
  _host: string,
  _opts: unknown,
  cb: (err: null, addresses: LookupAddress[]) => void,
) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never;

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<title>hello</title>");
        return;
      case "/big":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(10_000));
        return;
      case "/to-metadata":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      case "/to-relative":
        res.writeHead(301, { location: "/ok" });
        res.end();
        return;
      case "/loop":
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.5.4",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fd00::1",
    "fe80::1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("assertPublicUrl", () => {
  it.each([
    "ftp://example.com/",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/",
    "http://metadata/",
    "http://db.internal/",
    "http://printer.local/",
    "http://user:pass@example.com/",
  ])("rejects %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow(SsrfBlockedError);
  });

  it("accepts a public https URL", () => {
    expect(assertPublicUrl("https://example.com/about").hostname).toBe("example.com");
  });
});

describe("safeFetch", () => {
  it("refuses a public-looking hostname that resolves to a private address", async () => {
    const safeFetch = createSafeFetch({ lookup: fakeLookup });
    const err = await safeFetch(`http://public.test:${port}/ok`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const cause = (err as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(SsrfBlockedError);
  });

  describe("with an allow-all address policy", () => {
    const safeFetch = createSafeFetch({ lookup: fakeLookup, isBlockedAddress: () => false });
    const base = () => `http://public.test:${port}`;

    it("returns status, headers and body", async () => {
      const res = await safeFetch(`${base()}/ok`);
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(res.text()).toBe("<title>hello</title>");
    });

    it("follows a relative redirect and reports the final URL", async () => {
      const res = await safeFetch(`${base()}/to-relative`);
      expect(res.text()).toBe("<title>hello</title>");
      expect(res.url).toBe(`${base()}/ok`);
    });

    it("re-validates every redirect hop", async () => {
      await expect(safeFetch(`${base()}/to-metadata`)).rejects.toBeInstanceOf(SsrfBlockedError);
    });

    it("caps redirect chains", async () => {
      await expect(safeFetch(`${base()}/loop`, { maxRedirects: 3 })).rejects.toThrow(
        /Too many redirects/,
      );
    });

    it("truncates bodies past maxBytes by default", async () => {
      const res = await safeFetch(`${base()}/big`, { maxBytes: 100 });
      expect(res.bytes.byteLength).toBe(100);
      expect(res.truncated).toBe(true);
    });

    it("rejects oversized bodies when onOverflow is error", async () => {
      await expect(
        safeFetch(`${base()}/big`, { maxBytes: 100, onOverflow: "error" }),
      ).rejects.toBeInstanceOf(ResponseTooLargeError);
    });
  });
});
