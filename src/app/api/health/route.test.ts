import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("health diagnostics", () => {
  it("reports route-specific Kie readiness without secrets", async () => {
    const response = GET();
    const body = await response.json();

    expect(body.kie.image).toEqual(
      expect.objectContaining({
        defaultRouteConfigured: expect.any(Boolean),
        imageToImageRouteConfigured: expect.any(Boolean),
        availability: "not-probed",
      }),
    );
    expect(body.kie).not.toHaveProperty("apiKey");
    expect(body.kie).not.toHaveProperty("serviceRoleKey");
    expect(body.services).toEqual(
      expect.objectContaining({
        imageGeneration: expect.any(Boolean),
        imageToImage: expect.any(Boolean),
      }),
    );
  });
});
