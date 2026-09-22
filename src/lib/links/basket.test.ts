import { describe, expect, it } from "vitest";

import {
  classifyItems,
  payVerdict,
  preflightVerdict,
  type BasketItemLike,
  type BasketReport,
  type CandidateLine,
} from "./basket";

const ORDER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<BasketItemLike> = {}): BasketItemLike {
  return {
    basketId: 1,
    domain: "blog.com",
    priceUsd: 10,
    targetUrl: "https://mysite.com/pricing",
    keyword: "best crm",
    ...overrides,
  };
}

function line(overrides: Partial<CandidateLine> = {}): CandidateLine {
  return {
    lineId: "line-1",
    orderId: ORDER,
    donorDomain: "blog.com",
    unitPriceUsd: 10,
    targetUrl: "https://mysite.com/pricing",
    keyword: "best crm",
    ...overrides,
  };
}

function report(
  items: BasketItemLike[],
  pinned: Map<number, CandidateLine>,
  inFlight: CandidateLine[] = [],
): BasketReport {
  return classifyItems(items, pinned, inFlight);
}

describe("classifyItems", () => {
  it("treats a pinned basket id as certain", () => {
    const pinned = new Map([[1, line()]]);
    const result = report([item()], pinned);

    expect(result.items[0].classification).toEqual({
      kind: "ours_pinned",
      orderId: ORDER,
      lineId: "line-1",
    });
    expect(result.foreignCount).toBe(0);
    expect(result.pinnedOrderIds).toEqual([ORDER]);
  });

  it("matches an unpinned item to a single in-flight line with high confidence", () => {
    const result = report([item({ basketId: 99 })], new Map(), [line()]);

    expect(result.items[0].classification).toMatchObject({
      kind: "ours_likely",
      confidence: "high",
    });
  });

  it("downgrades to low confidence when two orders could claim the same item", () => {
    const result = report([item({ basketId: 99 })], new Map(), [
      line(),
      line({ lineId: "line-2", orderId: OTHER }),
    ]);

    expect(result.items[0].classification).toMatchObject({ confidence: "low" });
    expect(result.ambiguousCount).toBe(1);
  });

  it("calls an item nobody ordered foreign", () => {
    const result = report([item({ basketId: 99, domain: "someone-else.com" })], new Map(), [
      line(),
    ]);

    expect(result.items[0].classification).toEqual({ kind: "foreign" });
    expect(result.foreignCount).toBe(1);
  });

  it("does not match on domain and price alone when the article differs", () => {
    // Two workspaces buying the same site must not collide.
    const result = report(
      [item({ basketId: 99, targetUrl: "https://other-brand.com/" })],
      new Map(),
      [line()],
    );

    expect(result.items[0].classification).toEqual({ kind: "foreign" });
  });

  it("ignores a www prefix when comparing domains", () => {
    const result = report([item({ basketId: 99, domain: "www.blog.com" })], new Map(), [line()]);
    expect(result.items[0].classification).toMatchObject({ kind: "ours_likely" });
  });
});

describe("preflightVerdict", () => {
  it("clears an empty basket", () => {
    expect(preflightVerdict(report([], new Map()), ORDER)).toEqual({ kind: "clear" });
  });

  it("treats a basket holding only this order as a resume", () => {
    const pinned = new Map([[1, line()]]);
    expect(preflightVerdict(report([item()], pinned), ORDER)).toEqual({
      kind: "resume_this_order",
    });
  });

  it("waits when another order owns the basket", () => {
    const pinned = new Map([[1, line({ orderId: OTHER })]]);
    expect(preflightVerdict(report([item()], pinned), ORDER)).toEqual({
      kind: "other_order_owns",
      orderId: OTHER,
    });
  });

  it("blocks on a foreign item rather than ordering alongside it", () => {
    const result = preflightVerdict(report([item({ basketId: 99 })], new Map()), ORDER);
    expect(result.kind).toBe("blocked");
  });

  it("blocks when an item could belong to more than one order", () => {
    const result = preflightVerdict(
      report([item({ basketId: 99 })], new Map(), [line(), line({ lineId: "l2", orderId: OTHER })]),
      ORDER,
    );
    expect(result.kind).toBe("blocked");
  });
});

describe("payVerdict", () => {
  const expectedLines = [{ donorDomain: "blog.com", unitPriceUsd: 10 }];

  it("pays when the pinned set, the donors and the total all agree", () => {
    const pinned = new Map([[1, line()]]);
    const result = payVerdict({
      report: report([item()], pinned),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result).toEqual({ kind: "go", totalUsd: 10 });
  });

  it("refuses to pay for an item that is only probably ours", () => {
    // A shape match is enough to order around, never enough to spend on.
    const result = payVerdict({
      report: report([item({ basketId: 99 })], new Map(), [line()]),
      orderId: ORDER,
      expectedBasketIds: [99],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("refuses when the basket holds an extra item", () => {
    const pinned = new Map([
      [1, line()],
      [2, line({ lineId: "line-2" })],
    ]);
    const result = payVerdict({
      report: report([item(), item({ basketId: 2 })], pinned),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("refuses when one of our items is missing from the basket", () => {
    const pinned = new Map([[1, line()]]);
    const result = payVerdict({
      report: report([item()], pinned),
      orderId: ORDER,
      expectedBasketIds: [1, 2],
      expectedTotalUsd: 20,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("refuses when an item belongs to a different order", () => {
    const pinned = new Map([[1, line({ orderId: OTHER })]]);
    const result = payVerdict({
      report: report([item()], pinned),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("refuses on a one-cent difference between the basket and the quote", () => {
    const pinned = new Map([[1, line()]]);
    const result = payVerdict({
      report: report([item({ priceUsd: 10.01 })], pinned),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("refuses when the basket holds a different site at the right price", () => {
    // This is what catches the provider returning basket ids in an order we
    // did not assume — position is never trusted, the donor is checked.
    const pinned = new Map([[1, line()]]);
    const result = payVerdict({
      report: report([item({ domain: "unexpected.com" })], pinned),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });

  it("never pays for an empty basket", () => {
    const result = payVerdict({
      report: report([], new Map()),
      orderId: ORDER,
      expectedBasketIds: [1],
      expectedTotalUsd: 10,
      expectedLines,
    });

    expect(result.kind).toBe("hold");
  });
});
