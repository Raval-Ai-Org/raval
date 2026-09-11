// safe-fetch.ts — the ONLY way server code may fetch a URL a user supplied
// (site audits, brand crawls, competitor snapshots, asset downloads).
//
// A hostname check alone is not an SSRF guard: a public host can 302 to
// http://169.254.169.254/, and a public-looking name can resolve to 10.0.0.5.
// This module closes both holes:
//   1. `assertPublicUrl` — fast syntactic check (scheme, IP literals, internal
//      names) used for early 400s and on every redirect hop.
//   2. A guarded DNS lookup on the undici connection pool — the address the
//      socket actually connects to is checked, so DNS tricks cannot bypass it.
//   3. Manual redirects (each hop re-validated) and a streaming byte cap.
import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// Separate lists per family: a single BlockList matches IPv4 input against
// IPv6 rules via the ::ffff:0:0/96 mapping, which would block every address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blockedV4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blockedV6.addSubnet(net, prefix, "ipv6");
}

/** The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d), if any. */
function mappedIPv4(v6: string): string | null {
  // Normalise both spellings (::ffff:127.0.0.1 and ::ffff:7f00:1) via the URL parser.
  const host = new URL(`http://[${v6}]/`).hostname.slice(1, -1);
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True for loopback, private, link-local, metadata and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (family === 6) {
    const v4 = mappedIPv4(address);
    return v4 ? blockedV4.check(v4, "ipv4") : blockedV6.check(address, "ipv6");
  }
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(message = "URL host is not allowed") {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const INTERNAL_NAME =
  /(^localhost$)|(\.localhost$)|(\.local$)|(\.internal$)|(\.lan$)|(\.home\.arpa$)/i;

/**
 * Syntactic check: http(s) only, no blocked IP literals, no internal names.
 * Single-label hosts ("metadata", "db") are rejected — they resolve through
 * the server's search domain, i.e. to internal infrastructure.
 */
export function assertPublicUrl(raw: string | URL): URL {
  const url = typeof raw === "string" ? new URL(raw) : raw;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError("Only http(s) URLs are allowed");
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("URLs with credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new SsrfBlockedError();
    return url;
  }
  if (INTERNAL_NAME.test(host) || !host.includes(".")) throw new SsrfBlockedError();
  return url;
}

type LookupFn = typeof dnsLookup;
type AddressPredicate = (address: string) => boolean;

/**
 * Wrap a DNS lookup so a connection is refused if ANY resolved address is
 * blocked. Handles both callback shapes Node uses (`all: true` for
 * happy-eyeballs, single address otherwise).
 */
function guardedLookup(resolve: LookupFn, isBlocked: AddressPredicate): LookupFn {
  return ((hostname: string, options: unknown, callback: unknown) => {
    const opts = (typeof options === "object" && options !== null ? options : {}) as {
      all?: boolean;
    };
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void;

    resolve(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((a) => isBlocked(a.address))) {
        const blockedErr = new SsrfBlockedError(
          `Refusing to connect: ${hostname} resolves to a non-public address`,
        ) as NodeJS.ErrnoException;
        blockedErr.code = "ESSRFBLOCKED";
        return cb(blockedErr);
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  }) as LookupFn;
}

export type SafeFetchOptions = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Whole-request deadline, redirects included. Default 10s. */
  timeoutMs?: number;
  /** Body cap. Default 5 MB. */
  maxBytes?: number;
  /** `truncate` keeps the first maxBytes (crawling); `error` rejects (downloads). */
  onOverflow?: "truncate" | "error";
  /** Default 5. */
  maxRedirects?: number;
};

export type SafeFetchResult = {
  ok: boolean;
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  bytes: Uint8Array;
  truncated: boolean;
  text(): string;
};

export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Response exceeded ${maxBytes} bytes`);
    this.name = "ResponseTooLargeError";
  }
}

export type SafeFetchDeps = {
  /** Injected for tests; defaults to node:dns lookup. */
  lookup?: LookupFn;
  /** Injected for tests; defaults to isBlockedAddress. */
  isBlockedAddress?: AddressPredicate;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onOverflow: "truncate" | "error",
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        if (onOverflow === "error") throw new ResponseTooLargeError(maxBytes);
        chunks.push(value.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

export function createSafeFetch(deps: SafeFetchDeps = {}) {
  const dispatcher = new Agent({
    connect: {
      lookup: guardedLookup(deps.lookup ?? dnsLookup, deps.isBlockedAddress ?? isBlockedAddress),
    },
  });

  return async function safeFetch(
    input: string | URL,
    opts: SafeFetchOptions = {},
  ): Promise<SafeFetchResult> {
    const maxRedirects = opts.maxRedirects ?? 5;
    const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
    let url = assertPublicUrl(typeof input === "string" ? input : new URL(input.toString()));

    for (let hop = 0; ; hop++) {
      const res = await undiciFetch(url, {
        method: opts.method ?? "GET",
        headers: opts.headers,
        redirect: "manual",
        signal,
        dispatcher,
      });

      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) throw new Error(`Redirect ${res.status} without a Location header`);
        if (hop >= maxRedirects) throw new Error(`Too many redirects (> ${maxRedirects})`);
        url = assertPublicUrl(new URL(location, url));
        continue;
      }

      const { bytes, truncated } = await readCapped(
        res.body as ReadableStream<Uint8Array> | null,
        opts.maxBytes ?? 5 * 1024 * 1024,
        opts.onOverflow ?? "truncate",
      );
      const headers = new Headers();
      res.headers.forEach((value, key) => headers.set(key, value));
      return {
        ok: res.ok,
        status: res.status,
        url: url.toString(),
        headers,
        bytes,
        truncated,
        text: () => new TextDecoder().decode(bytes),
      };
    }
  };
}

/** Process-wide instance — shares one guarded connection pool. */
export const safeFetch = createSafeFetch();

/**
 * Crawl helper: the body as text when the request succeeds with a text-ish
 * content type, "" otherwise. Never throws — crawls degrade page by page.
 */
export async function fetchPublicText(
  url: string | URL,
  opts: SafeFetchOptions & { requireTextContent?: boolean } = {},
): Promise<string> {
  try {
    const res = await safeFetch(url, opts);
    if (!res.ok) return "";
    if (opts.requireTextContent) {
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html") && !type.includes("text") && !type.includes("xml")) return "";
    }
    return res.text();
  } catch {
    return "";
  }
}
