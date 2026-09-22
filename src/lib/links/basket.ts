// Deciding what is in the shared provider basket, and whether it is safe to
// order into it or pay for it. Pure, so every branch is unit-testable — which
// matters more here than anywhere else in the product, because a wrong answer
// spends real money that cannot be recovered.
//
// The fetching half lives in src/server/links/reconcile.server.ts.
//
// Background: the provider has ONE basket shared by every Mellox workspace, no
// way to remove an item from it, and a pay call that charges for everything
// present. So an item Mellox cannot certainly claim is never paid for.

/** The parts of a provider basket item these decisions rely on. */
export type BasketItemLike = {
  basketId: number | null;
  domain: string | null;
  priceUsd: number | null;
  targetUrl: string | null;
  keyword: string | null;
};

/** A line of a Mellox order, as far as matching is concerned. */
export type CandidateLine = {
  lineId: string;
  orderId: string;
  donorDomain: string;
  unitPriceUsd: number;
  targetUrl: string;
  keyword: string;
};

export type BasketClass =
  /** The item's basket id is pinned to a line. Certain. */
  | { kind: "ours_pinned"; orderId: string; lineId: string }
  /** No pinned id, but an in-flight order was asking for exactly this. */
  | { kind: "ours_likely"; orderId: string; lineId: string; confidence: "high" | "low" }
  /** Not ours, or not ours provably. Never paid for. */
  | { kind: "foreign" };

export type ClassifiedItem<T extends BasketItemLike = BasketItemLike> = {
  item: T;
  classification: BasketClass;
};

export type BasketReport<T extends BasketItemLike = BasketItemLike> = {
  items: ClassifiedItem<T>[];
  empty: boolean;
  /** Orders that own at least one pinned item in the basket right now. */
  pinnedOrderIds: string[];
  foreignCount: number;
  ambiguousCount: number;
};

export function sameDomain(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return norm(a) === norm(b);
}

/** Money compares to the cent; anything looser would let a drift through. */
export function samePrice(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.005;
}

/**
 * Classifies every item in the basket.
 *
 * Order matters: a pinned basket id is proof, a shape match is a guess, and a
 * guess that two orders could both claim is downgraded to `low` so callers can
 * refuse to act on it.
 */
export function classifyItems<T extends BasketItemLike>(
  items: T[],
  pinned: Map<number, CandidateLine>,
  inFlight: CandidateLine[],
): BasketReport<T> {
  if (items.length === 0) {
    return { items: [], empty: true, pinnedOrderIds: [], foreignCount: 0, ambiguousCount: 0 };
  }

  const classified: ClassifiedItem<T>[] = items.map((item) => {
    if (item.basketId !== null) {
      const match = pinned.get(item.basketId);
      if (match) {
        return {
          item,
          classification: {
            kind: "ours_pinned" as const,
            orderId: match.orderId,
            lineId: match.lineId,
          },
        };
      }
    }

    const matches = inFlight.filter(
      (line) =>
        sameDomain(line.donorDomain, item.domain) &&
        samePrice(line.unitPriceUsd, item.priceUsd) &&
        // The article's own fields have to agree too, or two workspaces buying
        // the same site for the same page would be indistinguishable.
        (!item.targetUrl || item.targetUrl === line.targetUrl) &&
        (!item.keyword || item.keyword === line.keyword),
    );

    if (matches.length === 1) {
      return {
        item,
        classification: {
          kind: "ours_likely" as const,
          orderId: matches[0].orderId,
          lineId: matches[0].lineId,
          confidence: "high" as const,
        },
      };
    }
    if (matches.length > 1) {
      return {
        item,
        classification: {
          kind: "ours_likely" as const,
          orderId: matches[0].orderId,
          lineId: matches[0].lineId,
          confidence: "low" as const,
        },
      };
    }
    return { item, classification: { kind: "foreign" as const } };
  });

  const pinnedOrderIds = [
    ...new Set(
      classified
        .map((entry) =>
          entry.classification.kind === "ours_pinned" ? entry.classification.orderId : null,
        )
        .filter((id): id is string => id !== null),
    ),
  ];

  return {
    items: classified,
    empty: false,
    pinnedOrderIds,
    foreignCount: classified.filter((entry) => entry.classification.kind === "foreign").length,
    ambiguousCount: classified.filter(
      (entry) =>
        entry.classification.kind === "ours_likely" && entry.classification.confidence === "low",
    ).length,
  };
}

export type PreflightVerdict =
  /** Basket is empty; it is safe to place an order. */
  | { kind: "clear" }
  /** Everything present belongs to this order — a resume, not a fresh start. */
  | { kind: "resume_this_order" }
  /** Another order owns the basket; it must finish first. */
  | { kind: "other_order_owns"; orderId: string }
  /** Something we cannot claim is present. Stop and ask a human. */
  | { kind: "blocked"; reason: string };

/**
 * The gate in front of the provider's order call. Basket exclusivity lives
 * here: unless this returns `clear` or `resume_this_order`, nothing is added.
 */
export function preflightVerdict(report: BasketReport, orderId: string): PreflightVerdict {
  if (report.empty) return { kind: "clear" };

  if (report.foreignCount > 0) {
    return {
      kind: "blocked",
      reason: `${report.foreignCount} item(s) in the provider basket do not belong to any Mellox order.`,
    };
  }
  if (report.ambiguousCount > 0) {
    return {
      kind: "blocked",
      reason: `${report.ambiguousCount} item(s) in the provider basket could belong to more than one order.`,
    };
  }

  const owners = new Set(
    report.items
      .map((entry) =>
        entry.classification.kind === "foreign" ? null : entry.classification.orderId,
      )
      .filter((id): id is string => id !== null),
  );

  if (owners.size === 1 && owners.has(orderId)) return { kind: "resume_this_order" };
  if (owners.size === 1) return { kind: "other_order_owns", orderId: [...owners][0] };

  return {
    kind: "blocked",
    reason: `The provider basket holds items from ${owners.size} different orders.`,
  };
}

export type PayVerdict = { kind: "go"; totalUsd: number } | { kind: "hold"; reason: string };

/**
 * The gate in front of the provider's pay call. Far stricter than preflight,
 * because paying is irreversible: only pinned basket ids count, the set has to
 * match in both directions, and the total has to match to the cent.
 *
 * The per-item donor and price check is also what verifies the undocumented
 * assumption that the provider returns basket ids in the same order as the
 * donor ids we sent — rather than trusting array position.
 */
export function payVerdict(args: {
  report: BasketReport;
  orderId: string;
  expectedBasketIds: number[];
  expectedTotalUsd: number;
  expectedLines: { donorDomain: string; unitPriceUsd: number }[];
}): PayVerdict {
  const { report, orderId, expectedBasketIds, expectedTotalUsd } = args;

  if (report.empty) {
    return { kind: "hold", reason: "The provider basket is empty — there is nothing to pay for." };
  }

  const present = new Set<number>();
  for (const entry of report.items) {
    if (entry.classification.kind !== "ours_pinned" || entry.classification.orderId !== orderId) {
      return { kind: "hold", reason: "The provider basket holds an item this order does not own." };
    }
    if (entry.item.basketId === null) {
      return { kind: "hold", reason: "The provider basket returned an item with no id." };
    }
    present.add(entry.item.basketId);
  }

  const expected = new Set(expectedBasketIds);
  for (const id of expected) {
    if (!present.has(id)) {
      return { kind: "hold", reason: "An item this order created is missing from the basket." };
    }
  }
  if (present.size !== expected.size) {
    return { kind: "hold", reason: "The basket holds more items than this order created." };
  }

  const remaining = [...args.expectedLines];
  for (const entry of report.items) {
    const index = remaining.findIndex(
      (line) =>
        sameDomain(line.donorDomain, entry.item.domain) &&
        samePrice(line.unitPriceUsd, entry.item.priceUsd),
    );
    if (index === -1) {
      return {
        kind: "hold",
        reason: `The basket item for ${entry.item.domain ?? "an unknown site"} does not match what this order asked for.`,
      };
    }
    remaining.splice(index, 1);
  }

  const total = report.items.reduce((sum, entry) => sum + (entry.item.priceUsd ?? 0), 0);
  const rounded = Math.round(total * 100) / 100;
  if (Math.abs(rounded - expectedTotalUsd) >= 0.005) {
    return {
      kind: "hold",
      reason: `The basket totals ${rounded.toFixed(2)} but this order quoted ${expectedTotalUsd.toFixed(2)}.`,
    };
  }

  return { kind: "go", totalUsd: rounded };
}
