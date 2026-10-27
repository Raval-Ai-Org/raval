import { describe, expect, it } from "vitest";
import { calculateFunding, countsForFundingReserve, type FundingAccountInput } from "./funding";

function account(
  planId: FundingAccountInput["planId"],
  overrides: Partial<FundingAccountInput> = {},
): FundingAccountInput {
  return {
    accountId: `${planId}-account`,
    ownerUserId: `${planId}-owner`,
    ownerEmail: `${planId}@example.com`,
    planId,
    status: "active",
    interval: "month",
    currentPeriodEnd: null,
    nextGrantAt: null,
    purchaseRecordedAt: "2026-10-24T00:00:00.000Z",
    meters: {
      creation: { available: 0, held: 0, debt: 0 },
      credits: { available: 100, held: 2, debt: 0 },
      video: { available: 200, held: 0, debt: 0 },
      pro_messages: { available: 3, held: 0, debt: 0 },
      flash_messages: { available: 40, held: 0, debt: 0 },
    },
    ...overrides,
  };
}

const live = (balance: number) => ({
  configured: true,
  state: "live" as const,
  balance,
  checkedAt: "2026-10-23T00:00:00.000Z",
  message: "Live",
});

describe("calculateFunding", () => {
  it("requires $40 of provider credits and $41.65 cash for one unfunded Starter account", () => {
    const result = calculateFunding({
      accounts: [account("starter")],
      openRouter: live(0),
      kie: live(0),
      dependencies: [],
    });

    expect(result.providers[0]).toMatchObject({
      reserveUsd: 30,
      shortfallUsd: 30,
      purchaseFeeUsd: 1.65,
      cashRequiredUsd: 31.65,
    });
    expect(result.providers[1]).toMatchObject({
      reserveUsd: 10,
      reserveCredits: 2_000,
      shortfallCredits: 2_000,
      cashRequiredUsd: 10,
    });
    expect(result.calculation).toMatchObject({
      totalReserveUsd: 40,
      verifiedTopUpUsd: 40,
      estimatedCashRequiredUsd: 41.65,
    });
  });

  it("calculates the exact upward-rounded top-up for three plan accounts", () => {
    const result = calculateFunding({
      generatedAt: "2026-10-23T00:00:00.000Z",
      accounts: [account("free"), account("starter"), account("growth")],
      openRouter: live(50),
      kie: live(1_000),
      dependencies: [],
    });

    expect(result.calculation.totalReserveUsd).toBe(149);
    expect(result.providers[0]).toMatchObject({
      id: "openrouter",
      reserveUsd: 124,
      balanceUsd: 50,
      shortfallUsd: 74,
      purchaseFeeUsd: 4.07,
      cashRequiredUsd: 78.07,
    });
    expect(result.providers[1]).toMatchObject({
      id: "kie",
      reserveUsd: 25,
      reserveCredits: 5_000,
      balanceUsd: 5,
      shortfallUsd: 20,
      shortfallCredits: 4_000,
    });
    expect(result.calculation.verifiedTopUpUsd).toBe(94);
    expect(result.calculation.estimatedCashRequiredUsd).toBe(98.07);
    expect(result.status).toBe("action_needed");
  });

  it("does not reserve provider money for paused accounts", () => {
    const result = calculateFunding({
      accounts: [account("scale", { status: "paused" })],
      openRouter: live(0),
      kie: live(0),
      dependencies: [],
    });

    expect(result.calculation.totalReserveUsd).toBe(0);
    expect(result.accounts[0]?.reserveEligible).toBe(false);
    expect(result.accounts[0]?.reserve.totalUsd).toBe(0);
    expect(result.status).toBe("healthy");
  });

  it("marks the result unverified instead of inventing a missing provider balance", () => {
    const result = calculateFunding({
      accounts: [account("starter")],
      openRouter: {
        configured: true,
        state: "unavailable",
        balance: null,
        checkedAt: "2026-10-23T00:00:00.000Z",
        message: "Unavailable",
      },
      kie: live(2_000),
      dependencies: [],
    });

    expect(result.providers[0]?.shortfallUsd).toBeNull();
    expect(result.calculation.unverifiedProviders).toBe(1);
    expect(result.status).toBe("unverified");
  });
});

describe("countsForFundingReserve", () => {
  const countingFrom = "2026-10-23T19:30:00.000Z";

  it("ignores existing accounts, Free plans, and accounts without a paid subscription record", () => {
    expect(
      countsForFundingReserve({
        planId: "agency",
        status: "active",
        purchaseRecordedAt: "2026-10-23T19:29:59.999Z",
        countingFrom,
      }),
    ).toBe(false);
    expect(
      countsForFundingReserve({
        planId: "free",
        status: "free",
        purchaseRecordedAt: "2026-10-24T00:00:00.000Z",
        countingFrom,
      }),
    ).toBe(false);
    expect(
      countsForFundingReserve({
        planId: "growth",
        status: "trialing",
        purchaseRecordedAt: null,
        countingFrom,
      }),
    ).toBe(false);
  });

  it("counts a paid plan only after the baseline", () => {
    expect(
      countsForFundingReserve({
        planId: "starter",
        status: "active",
        purchaseRecordedAt: "2026-10-23T19:30:00.000Z",
        countingFrom,
      }),
    ).toBe(true);
  });
});
