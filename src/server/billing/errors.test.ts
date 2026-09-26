import { describe, expect, it } from "vitest";
import { knownErrorResponse } from "@/server/route";
import {
  BrandFrozenError,
  InsufficientBalanceError,
  LimitReachedError,
  SpendNotAllowedError,
  UpgradeRequiredError,
} from "./errors";

describe("billing HTTP errors", () => {
  it.each([
    new UpgradeRequiredError({
      feature: "campaigns",
      requiredPlan: "growth",
      currentPlan: "starter",
    }),
    new InsufficientBalanceError({
      meter: "video",
      needed: 100,
      available: 25,
      options: ["video_pack"],
    }),
    new LimitReachedError({ limit: "brands", used: 3, max: 3, requiredPlan: "agency" }),
    new SpendNotAllowedError(),
    new BrandFrozenError(),
  ])("maps %s to structured 402", async (error) => {
    const response = knownErrorResponse(error);
    expect(response?.status).toBe(402);
    expect(await response?.json()).toMatchObject({ code: error.code, message: error.message });
  });
});
