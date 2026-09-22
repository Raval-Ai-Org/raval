// The only module that talks to the fulfilment provider, and the only one that
// reads RIXOT_API_KEY. Everything above it deals in Mellox types.
//
// Two rules are enforced here rather than left to callers:
//
//   1. POST is never retried. The provider has no idempotency key on its order
//      call, so a retry after a connection reset can duplicate a basket item —
//      and there is no endpoint to remove one. An unknown POST outcome is
//      resolved by READING the basket (see order-runner.server.ts), never by
//      repeating the write. `post()` therefore takes no retry option at all.
//   2. Nothing from the provider is trusted as a number or a string until it
//      has been through the normalisers below.
import "server-only";

import { HttpError } from "@/server/http-error";

const DEFAULT_BASE_URL = "https://ai.rixot.com/v1";
const GET_TIMEOUT_MS = 30_000;
const ORDER_TIMEOUT_MS = 30_000;
const PAY_TIMEOUT_MS = 60_000;

/** Provider catalog page size. Fixed by the provider, not configurable. */
export const DONORS_PER_PAGE = 20;

export class RixotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Transient means "safe to try again later", never "safe to repeat now". */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "RixotError";
  }
}

export function rixotConfigured(): boolean {
  return Boolean(process.env.RIXOT_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.RIXOT_API_KEY?.trim();
  if (!key) {
    // A missing credential is ours, never the user's fault.
    throw new HttpError(503, "Link buying is not available right now.");
  }
  return key;
}

function baseUrl(): string {
  const raw = process.env.RIXOT_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

// ── Value normalisers ───────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Money is compared for exact equality before we spend, so round once, here. */
function usd(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed * 100) / 100;
}

// ── Transport ───────────────────────────────────────────────────────────────

type Envelope = {
  success: boolean;
  data?: unknown;
  error?: unknown;
  count?: unknown;
  pagination?: unknown;
};

function describeError(status: number, body: Envelope | null): RixotError {
  const err = isRecord(body?.error) ? body.error : null;
  const code = str(err?.code) ?? (status >= 500 ? "server_error" : "bad_request");
  const detail = str(err?.message) ?? "";

  // The provider's own messages are for us, not for the user. Each branch picks
  // the sentence a customer should actually see.
  if (status === 401 || code === "unauthorized") {
    return new RixotError(503, "unauthorized", "Link buying is not available right now.", false);
  }
  if (code === "own_content_disabled") {
    return new RixotError(
      422,
      code,
      "This account cannot publish your own article text. Let Mellox write it instead.",
      false,
    );
  }
  if (status === 403 || code === "forbidden") {
    return new RixotError(503, code, "Link buying is not available right now.", false);
  }
  if (code === "payment_failed") {
    return new RixotError(
      402,
      code,
      detail || "The provider could not take payment for this basket.",
      false,
    );
  }
  if (status === 404) {
    return new RixotError(404, "not_found", "That placement is no longer available.", false);
  }
  if (status >= 500) {
    return new RixotError(502, code, "The provider is having trouble. We'll try again.", true);
  }
  return new RixotError(400, code, detail || "The provider rejected that request.", false);
}

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Envelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: "no-store",
    });

    let parsed: Envelope | null = null;
    try {
      parsed = (await response.json()) as Envelope;
    } catch {
      parsed = null;
    }

    if (!response.ok || !parsed || parsed.success !== true) {
      throw describeError(response.status, parsed);
    }
    return parsed;
  } catch (error) {
    if (error instanceof RixotError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      // A timeout is the dangerous case: the request may have been processed.
      // `transient` here means "resolve by reading", not "send it again".
      throw new RixotError(504, "timeout", "The provider did not answer in time.", true);
    }
    throw new RixotError(502, "network", "We could not reach the provider.", true);
  } finally {
    clearTimeout(timer);
  }
}

// ── Account ─────────────────────────────────────────────────────────────────

export type RixotAccount = {
  id: number | null;
  email: string | null;
  name: string | null;
  balanceUsd: number;
};

export async function getAccount(fetchImpl: typeof fetch = fetch): Promise<RixotAccount> {
  const body = await call("/me", { method: "GET", timeoutMs: GET_TIMEOUT_MS }, fetchImpl);
  const data = isRecord(body.data) ? body.data : {};
  return {
    id: int(data.id),
    email: str(data.email),
    name: str(data.name),
    balanceUsd: usd(data.balance) ?? 0,
  };
}

export async function getBalance(fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = await call("/balance", { method: "GET", timeoutMs: GET_TIMEOUT_MS }, fetchImpl);
  const data = isRecord(body.data) ? body.data : {};
  return usd(data.balance) ?? 0;
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export type RixotDonor = {
  id: number;
  domain: string;
  ext: string | null;
  page: string | null;
  domainHidden: boolean;
  priceUsd: number;
  dr: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  dfsRank: number | null;
  /** The provider's count of keywords the site ranks for. NOT traffic. */
  top100: number | null;
  /** Usually "0" or empty — the catalog has no dependable taxonomy. */
  cat: string | null;
  inBasket: boolean;
};

export type DonorPage = {
  donors: RixotDonor[];
  page: number;
  totalPages: number;
  totalRecords: number;
};

export type DonorFilters = {
  page?: number;
  domainFilter?: string;
  extFilter?: string;
  drMin?: number;
  priceMin?: number;
  priceMax?: number;
  referringDomainsMin?: number;
};

export function normalizeDonor(raw: unknown): RixotDonor | null {
  if (!isRecord(raw)) return null;
  const id = int(raw.id);
  const domain = str(raw.domain);
  if (id === null || !domain) return null;
  const drRaw = int(raw.dr);
  return {
    id,
    domain: domain.toLowerCase(),
    ext: str(raw.ext),
    page: str(raw.page),
    domainHidden: raw.domainHidden === true,
    priceUsd: usd(raw.price) ?? 0,
    // The catalog returns dr 0 for sites it has no rating for; keep the
    // difference between "rated 0" and "unrated" out of the UI by treating
    // an out-of-range value as unknown rather than inventing a number.
    dr: drRaw !== null && drRaw >= 0 && drRaw <= 100 ? drRaw : null,
    referringDomains: int(raw.dfs_referring_domains),
    backlinks: int(raw.dfs_backlinks),
    dfsRank: int(raw.dfs_rank),
    top100: int(raw.top100),
    cat: (() => {
      const value = str(raw.cat);
      return !value || value === "0" ? null : value;
    })(),
    inBasket: raw.in_basket === true,
  };
}

export async function listDonors(
  filters: DonorFilters = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DonorPage> {
  const params = new URLSearchParams();
  if (filters.page && filters.page > 1) params.set("page", String(Math.trunc(filters.page)));
  if (filters.domainFilter) params.set("domain_filter", filters.domainFilter);
  if (filters.extFilter) params.set("ext_filter", filters.extFilter);
  if (typeof filters.drMin === "number") params.set("dr_min", String(Math.trunc(filters.drMin)));
  if (typeof filters.priceMin === "number") params.set("price_min", String(filters.priceMin));
  if (typeof filters.priceMax === "number") params.set("price_max", String(filters.priceMax));
  if (typeof filters.referringDomainsMin === "number") {
    params.set("referring_domains_min", String(Math.trunc(filters.referringDomainsMin)));
  }
  const query = params.toString();
  const body = await call(
    `/donors${query ? `?${query}` : ""}`,
    { method: "GET", timeoutMs: GET_TIMEOUT_MS },
    fetchImpl,
  );

  const rows = Array.isArray(body.data) ? body.data : [];
  const pagination = isRecord(body.pagination) ? body.pagination : {};
  return {
    donors: rows.map(normalizeDonor).filter((d): d is RixotDonor => d !== null),
    page: int(pagination.current_page) ?? filters.page ?? 1,
    totalPages: int(pagination.total_pages) ?? 1,
    totalRecords: int(pagination.total_records) ?? rows.length,
  };
}

// ── Article brief ───────────────────────────────────────────────────────────

export type ArticlePrompt = { defaultPrompt: string; editableField: string };

export async function getArticlePrompt(
  input: { keyword: string; targetUrl: string; language?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ArticlePrompt> {
  const params = new URLSearchParams({
    keyword: input.keyword,
    target_url: input.targetUrl,
    language: input.language || "en",
  });
  const body = await call(
    `/article-prompt?${params.toString()}`,
    { method: "GET", timeoutMs: GET_TIMEOUT_MS },
    fetchImpl,
  );
  const data = isRecord(body.data) ? body.data : {};
  return {
    defaultPrompt: str(data.default_prompt) ?? "",
    editableField: str(data.editable_field) ?? "recommendations",
  };
}

// ── Basket ──────────────────────────────────────────────────────────────────

export type BasketItem = {
  basketId: number | null;
  orderContentId: number | null;
  donorId: number | null;
  domain: string | null;
  priceUsd: number | null;
  targetUrl: string | null;
  keyword: string | null;
  title: string | null;
  raw: Record<string, unknown>;
};

/**
 * The basket is the provider's only mirror of what we asked for, so it is
 * parsed defensively: unknown field spellings are kept in `raw` rather than
 * dropped, because reconciliation may need them for an operator to read.
 */
export function normalizeBasketItem(raw: unknown): BasketItem | null {
  if (!isRecord(raw)) return null;
  const domain = str(raw.domain) ?? str(raw.donor_domain) ?? str(raw.site);
  return {
    basketId: int(raw.basket_id) ?? int(raw.id),
    orderContentId: int(raw.order_content_id) ?? int(raw.content_id),
    donorId: int(raw.donor_id) ?? int(raw.donor),
    domain: domain ? domain.toLowerCase() : null,
    priceUsd: usd(raw.price) ?? usd(raw.price_usd) ?? usd(raw.cost),
    targetUrl: str(raw.target_url) ?? str(raw.article_url),
    keyword: str(raw.keyword) ?? str(raw.anchor),
    title: str(raw.title),
    raw,
  };
}

export async function getBasket(fetchImpl: typeof fetch = fetch): Promise<BasketItem[]> {
  const body = await call("/basket", { method: "GET", timeoutMs: GET_TIMEOUT_MS }, fetchImpl);
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.map(normalizeBasketItem).filter((i): i is BasketItem => i !== null);
}

// ── Ordering (money-critical) ───────────────────────────────────────────────

export type CreateOrderInput = {
  donorIds: number[];
  targetUrl: string;
  keyword: string;
  language?: string;
  /** Prompt mode: the brief Mellox built from Brand DNA. */
  recommendations?: string;
  /** Own mode: pre-written HTML. Requires the capability on the account. */
  content?: string;
  title?: string;
};

export type CreateOrderResult = {
  mode: string | null;
  orderContentIds: number[];
  basketIds: number[];
  totalUsd: number | null;
  status: string | null;
};

/**
 * Adds items to the provider basket. NOT a charge.
 *
 * Never call this twice for the same order without first reading the basket:
 * the provider has no idempotency key and no way to remove an item, so a
 * duplicate is money that cannot be recovered.
 */
export async function createOrder(
  input: CreateOrderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateOrderResult> {
  const payload: Record<string, unknown> = { donor_ids: input.donorIds };
  if (input.content) {
    payload.content = input.content;
    if (input.title) payload.title = input.title;
    if (input.targetUrl) payload.article_url = input.targetUrl;
  } else {
    payload.target_url = input.targetUrl;
    payload.keyword = input.keyword;
    payload.language = input.language || "en";
    if (input.recommendations) payload.recommendations = input.recommendations;
  }

  const body = await call(
    "/orders",
    { method: "POST", body: payload, timeoutMs: ORDER_TIMEOUT_MS },
    fetchImpl,
  );
  const data = isRecord(body.data) ? body.data : {};
  const ids = (value: unknown): number[] =>
    (Array.isArray(value) ? value : []).map(int).filter((n): n is number => n !== null);

  return {
    mode: str(data.mode),
    orderContentIds: ids(data.order_content_ids),
    basketIds: ids(data.basket_ids),
    totalUsd: usd(data.total_price),
    status: str(data.status),
  };
}

export type PayResult = { status: string | null; chargedUsd: number | null; links: number | null };

/**
 * Pays for EVERYTHING in the basket from the provider balance.
 *
 * This is why the basket must be verified item-by-item against one order's
 * pinned basket ids first: there is no way to pay for a subset.
 */
export async function payBasket(fetchImpl: typeof fetch = fetch): Promise<PayResult> {
  const body = await call(
    "/basket/pay",
    { method: "POST", body: {}, timeoutMs: PAY_TIMEOUT_MS },
    fetchImpl,
  );
  const data = isRecord(body.data) ? body.data : {};
  return {
    status: str(data.status),
    chargedUsd: usd(data.charged),
    links: int(data.links),
  };
}

// ── Links ───────────────────────────────────────────────────────────────────

export type ProviderLink = {
  id: number;
  targetUrl: string | null;
  keyword: string | null;
  status: string | null;
  publishedUrl: string | null;
  costUsd: number | null;
  raw: Record<string, unknown>;
};

export function normalizeLink(raw: unknown): ProviderLink | null {
  if (!isRecord(raw)) return null;
  const id = int(raw.id);
  if (id === null) return null;
  return {
    id,
    targetUrl: str(raw.target_url),
    keyword: str(raw.keyword),
    status: str(raw.status),
    publishedUrl: str(raw.published_url),
    costUsd: usd(raw.cost),
    raw,
  };
}

/** The provider's whole link list. No cursor, so "new" means "an unseen id". */
export async function listLinks(fetchImpl: typeof fetch = fetch): Promise<ProviderLink[]> {
  const body = await call("/links", { method: "GET", timeoutMs: GET_TIMEOUT_MS }, fetchImpl);
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.map(normalizeLink).filter((l): l is ProviderLink => l !== null);
}
