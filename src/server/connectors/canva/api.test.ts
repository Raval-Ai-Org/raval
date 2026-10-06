import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVA_SCOPES, canvaConfig, canvaMagicLayersEnabled, canvaOrigins } from "./config.server";
import {
  buildCanvaAuthorizeUrl,
  challengeFor,
  hashState,
  validCanvaStateRow,
} from "./oauth.server";
import {
  canvaRequest,
  createDesign,
  uploadImage,
  imageToDesign,
  importPptx,
  exportPngPages,
  createSingleImageDesign,
} from "./api.server";
import { safeCanvaReturn } from "@/lib/canva-return";

describe("Canva connector boundary", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("explains server configuration errors instead of returning an unknown failure", () => {
    vi.stubEnv("CANVA_CLIENT_ID", "client-id");
    vi.stubEnv("CANVA_CLIENT_SECRET", "client-secret");
    vi.stubEnv("CANVA_TOKEN_ENCRYPTION_KEY", "invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "s".repeat(64));
    vi.stubEnv("APP_URL", "https://mellox.ai");
    expect(canvaConfig().key).toHaveLength(32);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => canvaConfig()).toThrow("Canva token encryption key is missing or invalid");

    vi.stubEnv("CANVA_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
    vi.stubEnv("APP_URL", "http://mellox.ai");
    expect(() => canvaConfig()).toThrow("APP_URL must be a valid HTTPS origin");
    vi.stubEnv("APP_URL", "https://mellox.ai");
    expect(canvaConfig().redirectUri).toBe("https://mellox.ai/api/integrations/canva/callback");
  });

  it("calls back on 127.0.0.1 in development, because Canva refuses localhost", () => {
    expect(canvaOrigins("http://localhost:8080")).toEqual({
      appOrigin: "http://localhost:8080",
      redirectUri: "http://127.0.0.1:8080/api/integrations/canva/callback",
    });
    expect(canvaOrigins("https://mellox.ai/").appOrigin).toBe("https://mellox.ai");
  });

  it("uses exactly the requested scopes and S256 PKCE", () => {
    expect(CANVA_SCOPES).toEqual([
      "asset:read",
      "asset:write",
      "design:content:read",
      "design:content:write",
      "design:meta:read",
    ]);
    expect(challengeFor("verifier")).toBe("iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ");
    expect(hashState("state")).toHaveLength(64);
  });

  it("makes pictures editable unless explicitly turned off", () => {
    expect(canvaMagicLayersEnabled(undefined)).toBe(true);
    expect(canvaMagicLayersEnabled("false")).toBe(false);
    expect(canvaMagicLayersEnabled("true")).toBe(true);
  });

  it("builds the exact callback without exposing the client secret or verifier", () => {
    const authorizeUrl = buildCanvaAuthorizeUrl(
      {
        clientId: "client-id",
        redirectUri: "http://localhost:8080/api/integrations/canva/callback",
      },
      "opaque-state",
      "opaque-verifier",
    );
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:8080/api/integrations/canva/callback",
    );
    const expectedScopes =
      "asset:read asset:write design:content:read design:content:write design:meta:read";
    expect(url.searchParams.getAll("scope")).toEqual([expectedScopes]);
    expect(authorizeUrl.match(/[?&]scope=([^&]*)/g)).toEqual([
      `&scope=${encodeURIComponent(expectedScopes).replaceAll("%20", "+")}`,
    ]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_verifier")).toBeNull();
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  it("rejects expired, replayed, and wrong-user OAuth states", () => {
    const state = "a".repeat(64);
    const row = {
      user_id: "user-1",
      consumed_at: null,
      pkce_verifier_enc: "encrypted",
      expires_at: new Date(2000).toISOString(),
    };
    expect(validCanvaStateRow(state, row, "user-1", 1000)).toBe(true);
    expect(validCanvaStateRow(state, row, "user-2", 1000)).toBe(false);
    expect(validCanvaStateRow(state, row, "user-1", 2000)).toBe(false);
    expect(
      validCanvaStateRow(
        state,
        { ...row, consumed_at: new Date(1500).toISOString() },
        "user-1",
        1000,
      ),
    ).toBe(false);
    expect(validCanvaStateRow("short", row, "user-1", 1000)).toBe(false);
  });

  it("rejects return paths outside the explicit workspace", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(safeCanvaReturn(id, `/w/${id}/app?tab=studio`)).toBe(`/w/${id}/app?tab=studio`);
    expect(safeCanvaReturn(id, "https://evil.test")).toContain(`/w/${id}/app`);
    expect(safeCanvaReturn(id, "/w/22222222-2222-4222-8222-222222222222/app")).toContain(
      `/w/${id}/app`,
    );
  });

  it("uploads bytes and polls the asynchronous job", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(Response.json({ job: { id: "job1", status: "in_progress" } }));
    fetcher.mockResolvedValueOnce(
      Response.json({ job: { id: "job1", status: "success", asset: { id: "asset1" } } }),
    );
    await expect(uploadImage("token", Buffer.from("bytes"), "Slide 1")).resolves.toBe("asset1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes provider errors and never includes response bodies", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ secret: "do-not-leak" }, { status: 403 }));
    await expect(canvaRequest("token", "/designs")).rejects.toMatchObject({ status: 403 });
    try {
      await canvaRequest("token", "/designs");
    } catch (error) {
      expect(String(error)).not.toContain("do-not-leak");
    }
  });

  it.each([401, 403, 429, 503])("normalizes Canva HTTP %i", async (status) => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { token: "private" },
        { status, headers: status === 429 ? { "retry-after": "7" } : {} },
      ),
    );
    await expect(canvaRequest("token", "/designs")).rejects.toMatchObject({
      status: status === 503 ? 502 : status === 401 ? 409 : status,
    });
  });

  it("normalizes an upload failure and malformed design response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ job: { id: "job1", status: "failed" } }),
    );
    await expect(uploadImage("token", Buffer.from("bytes"), "Slide")).rejects.toMatchObject({
      status: 502,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ design: { id: "D1", urls: { edit_url: "https://evil.test/" } } }),
    );
    await expect(
      createDesign("token", { assetId: "A1", title: "Mellox", width: 1080, height: 1350 }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("creates a custom design from a single asset and validates its editor URL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        design: { id: "D123", urls: { edit_url: "https://www.canva.com/design/D123/edit" } },
      }),
    );
    await expect(
      createDesign("token", { assetId: "A1", title: "Mellox", width: 1080, height: 1350 }),
    ).resolves.toMatchObject({ id: "D123" });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      design_type: { type: "custom", width: 1080, height: 1350 },
      asset_id: "A1",
    });
  });

  it("creates an editable design from a Canva asset", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(
      Response.json({
        job: {
          id: "job1",
          status: "success",
          result: {
            design: { id: "D1", urls: { edit_url: "https://www.canva.com/design/D1/edit" } },
          },
        },
      }),
    );
    await expect(imageToDesign("token", "A1", "Title")).resolves.toMatchObject({ id: "D1" });
    const call = fetcher.mock.calls[0];
    expect(call[0]).toBe("https://api.canva.com/rest/v1/image-to-design-imports");
    expect(JSON.parse((call[1] as RequestInit).body as string).image).toEqual({ asset_id: "A1" });
  });

  it("polls a pending Magic Layers job before returning the editor", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.mocked(fetch);
      fetcher.mockResolvedValueOnce(Response.json({ job: { id: "J1", status: "in_progress" } }));
      fetcher.mockResolvedValueOnce(
        Response.json({
          job: {
            id: "J1",
            status: "success",
            result: {
              design: { id: "D1", urls: { edit_url: "https://www.canva.com/design/D1/edit" } },
            },
          },
        }),
      );
      const result = imageToDesign("token", "A1", "Title");
      await vi.runAllTimersAsync();
      await expect(result).resolves.toMatchObject({ id: "D1" });
      expect(fetcher.mock.calls[1][0]).toBe(
        "https://api.canva.com/rest/v1/image-to-design-imports/J1",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes AI quota failure", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(
      Response.json({
        job: { id: "job1", status: "failed", error: { code: "credit_quota_exceeded" } },
      }),
    );
    await expect(imageToDesign("token", "A1", "Title")).rejects.toMatchObject({
      code: "credit_quota_exceeded",
    });
  });

  it("uses public Create Design with the Preview flag off", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(
      Response.json({
        design: {
          id: "D1",
          urls: {
            edit_url: "https://www.canva.com/design/D1/edit",
          },
        },
      }),
    );
    const result = await createSingleImageDesign(
      "token",
      {
        assetId: "A1",
        title: "Title",
        width: 1080,
        height: 1080,
      },
      false,
    );
    expect(result.mode).toBe("flat_image");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/designs");
  });

  it("falls back after a Magic Layers quota response", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(
      Response.json({ code: "credit_quota_exceeded" }, { status: 429 }),
    );
    fetcher.mockResolvedValueOnce(
      Response.json({
        design: {
          id: "D2",
          urls: {
            edit_url: "https://www.canva.com/design/D2/edit",
          },
        },
      }),
    );
    const result = await createSingleImageDesign(
      "token",
      {
        assetId: "A1",
        title: "Title",
        width: 1080,
        height: 1080,
      },
      true,
    );
    expect(result).toMatchObject({ id: "D2", mode: "flat_image" });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://api.canva.com/rest/v1/image-to-design-imports",
      "https://api.canva.com/rest/v1/designs",
    ]);
  });

  it("records Magic Layers mode when conversion succeeds", async () => {
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce(
      Response.json({
        job: {
          id: "J1",
          status: "success",
          result: {
            design: { id: "D3", urls: { edit_url: "https://www.canva.com/design/D3/edit" } },
          },
        },
      }),
    );
    await expect(
      createSingleImageDesign(
        "token",
        {
          assetId: "A1",
          title: "Title",
          width: 1080,
          height: 1080,
        },
        true,
      ),
    ).resolves.toMatchObject({ id: "D3", mode: "magic_layers" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("imports one ordered multi-page PPTX design", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        job: {
          id: "J1",
          status: "success",
          result: {
            designs: [
              {
                id: "D1",
                page_count: 3,
                urls: { edit_url: "https://www.canva.com/design/D1/edit" },
              },
            ],
          },
        },
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ design: { page_count: 3 } }));
    await expect(importPptx("token", Buffer.from("pptx"), "Title")).resolves.toMatchObject({
      id: "D1",
      pageCount: 3,
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.canva.com/rest/v1/imports");
  });

  it("returns ordered PNG export page links", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        job: {
          id: "J1",
          status: "success",
          urls: ["https://export-download.canva.com/1", "https://export-download.canva.com/2"],
        },
      }),
    );
    await expect(exportPngPages("token", "D1")).resolves.toHaveLength(2);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ design_id: "D1", format: { type: "png", as_single_image: false } });
  });
});
