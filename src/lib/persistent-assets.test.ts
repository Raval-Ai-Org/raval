import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/authed-fetch", () => ({ authedFetch: mocked.fetch }));
vi.mock("@/lib/app-events", () => ({ emitAppEvent: vi.fn() }));
import { getSignedAssetUrls } from "./persistent-assets";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetch.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    return Response.json({
      urls: body.paths.map((path: string) => ({ path, url: `signed:${path}` })),
    });
  });
});
describe("Library signed URL requests", () => {
  it("signs libraries larger than the API limit in bounded batches", async () => {
    const paths = Array.from({ length: 201 }, (_, i) => `asset-${i}`);
    const signed = await getSignedAssetUrls("workspace", [...paths, paths[0]]);
    expect(Object.keys(signed)).toHaveLength(201);
    expect(
      mocked.fetch.mock.calls.map(([, options]) => JSON.parse(options.body).paths.length),
    ).toEqual([100, 100, 1]);
  });
  it("does not send invalid empty signing requests", async () => {
    expect(await getSignedAssetUrls("workspace", [])).toEqual({});
    expect(mocked.fetch).not.toHaveBeenCalled();
  });
});
