import { describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("@/server/safe-fetch", async (original) => ({
  ...(await original<typeof import("@/server/safe-fetch")>()),
  safeFetch: fetch,
}));
import { guardCaptureNetwork } from "./capture.server";
describe("visual capture network boundary", () => {
  it("fulfills every public request through guarded fetch, never forwards cookies and blocks private or mutating requests", async () => {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const sockets = vi.fn();
    const context = {
      routeWebSocket: vi.fn((_match, fn) => {
        sockets.mockImplementation(fn);
      }),
      route: vi.fn((_match, fn) => {
        handler = fn;
      }),
    };
    await guardCaptureNetwork(context as never);
    fetch.mockResolvedValue({
      status: 200,
      bytes: new Uint8Array([1]),
      headers: new Headers({ "content-type": "image/png", "set-cookie": "secret" }),
    });
    const make = (url: string, method = "GET") => ({
      request: () => ({ url: () => url, method: () => method, resourceType: () => "image" }),
      abort: vi.fn().mockResolvedValue(undefined),
      fulfill: vi.fn().mockResolvedValue(undefined),
    });
    const valid = make("https://brand.test/image.png");
    await handler!(valid);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ onOverflow: "error" }),
    );
    expect(valid.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "content-type": "image/png", "access-control-allow-origin": "*" },
      }),
    );
    const privateRequest = make("http://169.254.169.254/latest");
    await handler!(privateRequest);
    expect(privateRequest.abort).toHaveBeenCalled();
    const mutation = make("https://brand.test/contact", "POST");
    await handler!(mutation);
    expect(mutation.abort).toHaveBeenCalled();
    const socket = { close: vi.fn() };
    sockets(socket);
    expect(socket.close).toHaveBeenCalled();
  });
});

describe("artwork boxes", () => {
  it("keeps the largest distinct pictures inside the captured page", async () => {
    const { pickArtBoxes } = await import("./capture.server");
    const boxes = pickArtBoxes(
      [
        { left: 0, top: 0, width: 1440, height: 900, alt: "hero" },
        { left: 10, top: 10, width: 1400, height: 880, alt: "same hero" },
        { left: 100, top: 1200, width: 600, height: 400, alt: "card" },
        { left: 0, top: 17_900, width: 1440, height: 900, alt: "below the cut" },
        { left: 0, top: 2000, width: 300, height: 300, alt: "small" },
      ],
      1440,
      18_000,
      4,
    );
    expect(boxes.map((b) => b.alt)).toEqual(["hero", "card"]);
  });
});
