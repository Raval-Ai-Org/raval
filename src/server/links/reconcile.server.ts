// Working out whose items are sitting in the shared provider basket.
//
// This module is the database half: it loads the lines that could own a basket
// item and hands them to the pure decisions in src/lib/links/basket.ts, which
// is where every branch is unit-tested.
//
// It exists because the provider has no way to remove a basket item and its pay
// call charges for everything present. So before Mellox ever pays, every single
// item must be accounted for. An item we cannot certainly claim is not paid for
// and not quietly absorbed — it stops the queue and asks an operator.
import "server-only";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyItems, type BasketReport, type CandidateLine } from "@/lib/links/basket";
import type { BasketItem } from "./rixot/client.server";

export { preflightVerdict, payVerdict } from "@/lib/links/basket";
export type {
  BasketClass,
  BasketReport,
  ClassifiedItem,
  PayVerdict,
  PreflightVerdict,
} from "@/lib/links/basket";

/** Orders whose order call may have landed without us hearing the answer. */
const IN_FLIGHT_WINDOW_MS = 60 * 60 * 1000;

async function loadPinnedLines(basketIds: number[]): Promise<Map<number, CandidateLine>> {
  const map = new Map<number, CandidateLine>();
  if (basketIds.length === 0) return map;

  const { data } = await supabaseAdmin
    .from("link_order_lines")
    .select(
      "id, order_id, donor_domain, unit_price_usd, provider_basket_id, link_orders(target_url, keyword)",
    )
    .in("provider_basket_id", basketIds);

  for (const row of data ?? []) {
    const parent = row.link_orders as unknown as { target_url: string; keyword: string } | null;
    if (row.provider_basket_id === null) continue;
    map.set(Number(row.provider_basket_id), {
      lineId: row.id,
      orderId: row.order_id,
      donorDomain: row.donor_domain,
      unitPriceUsd: Number(row.unit_price_usd),
      targetUrl: parent?.target_url ?? "",
      keyword: parent?.keyword ?? "",
    });
  }
  return map;
}

async function loadInFlightLines(): Promise<CandidateLine[]> {
  const since = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString();

  const { data } = await supabaseAdmin
    .from("link_orders")
    .select(
      "id, target_url, keyword, link_order_lines(id, donor_domain, unit_price_usd, provider_basket_id)",
    )
    .in("status", ["ordering", "ordered", "paying"])
    .gte("updated_at", since)
    .limit(50);

  const lines: CandidateLine[] = [];
  for (const order of data ?? []) {
    const children = (order.link_order_lines ?? []) as unknown as {
      id: string;
      donor_domain: string;
      unit_price_usd: number;
      provider_basket_id: number | null;
    }[];
    for (const line of children) {
      // A pinned line is already certain; only unpinned ones need guessing at.
      if (line.provider_basket_id !== null) continue;
      lines.push({
        lineId: line.id,
        orderId: order.id,
        donorDomain: line.donor_domain,
        unitPriceUsd: Number(line.unit_price_usd),
        targetUrl: order.target_url,
        keyword: order.keyword,
      });
    }
  }
  return lines;
}

/** Loads the candidates and classifies the live basket. */
export async function classifyBasket(items: BasketItem[]): Promise<BasketReport<BasketItem>> {
  if (items.length === 0) {
    return { items: [], empty: true, pinnedOrderIds: [], foreignCount: 0, ambiguousCount: 0 };
  }

  const basketIds = items.map((item) => item.basketId).filter((id): id is number => id !== null);
  const [pinned, inFlight] = await Promise.all([loadPinnedLines(basketIds), loadInFlightLines()]);

  return classifyItems(items, pinned, inFlight);
}
