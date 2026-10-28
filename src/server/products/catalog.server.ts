// The brand's product catalogue, server half: find products on the brand's
// own website (Shopify's public feed first, else product pages linked from the
// homepage and sitemap), store one photo of each as a private workspace asset,
// and hand Studio the product a piece should show.
//
// Every fetch goes through safe-fetch. No model is called: discovery is free.
// Callers verify the person's role; this module trusts the workspace id it is
// given and scopes every query to it.
import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { extractInternalLinks, parseSitemapUrls } from "@/lib/crawl/html";
import { parseProductPage } from "@/lib/ugc/product-page";
import {
  MAX_PRODUCTS,
  SCAN_PAGE_LIMIT,
  candidateFromPage,
  parseShopifyProducts,
  pickProduct,
  productPageCandidates,
  productSitemaps,
  type CatalogCandidate,
  type CatalogProduct,
  type JobProduct,
} from "@/lib/products/catalog";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { persistAsset } from "@/server/assets/persist.server";
import { signStoragePath } from "@/server/assets/storage.server";
import { HttpError } from "@/server/http-error";
import { log } from "@/server/observability/logger";
import { assertPublicUrl, fetchPublicText, safeFetch } from "@/server/safe-fetch";

const db = supabaseAdmin as unknown as SupabaseClient;
const USER_AGENT = "Mozilla/5.0 (compatible; MelloxBot/1.0; +https://mellox.ai)";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Products stored per scan: enough to choose from, few enough to stay quick. */
const STORE_PER_SCAN = 16;

type Row = {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  price: string;
  description: string;
  category: string;
  image_asset_id: string | null;
  image_storage_path: string | null;
  image_source_url: string | null;
  source: "scan" | "manual";
  status: "active" | "removed";
  is_primary: boolean;
  position: number;
};

const checked = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

function missingTable(error: unknown) {
  return /workspace_products|does not exist|schema cache/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function readRows(workspaceId: string, includeRemoved = false): Promise<Row[]> {
  let query = db.from("workspace_products").select("*").eq("workspace_id", workspaceId);
  if (!includeRemoved) query = query.eq("status", "active");
  return checked(
    await query.order("position", { ascending: true }).order("created_at", { ascending: true }),
  ) as Row[];
}

async function present(row: Row): Promise<CatalogProduct> {
  const path =
    row.image_storage_path && isWorkspaceStoragePath(row.image_storage_path, row.workspace_id)
      ? row.image_storage_path
      : null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    price: row.price,
    description: row.description,
    category: row.category,
    source: row.source,
    isPrimary: row.is_primary,
    imageUrl: path ? ((await signStoragePath(db, path, 1800)) ?? null) : null,
  };
}

/** The brand's active products with signed photo URLs. Empty when the table isn't there yet. */
export async function listProducts(workspaceId: string): Promise<CatalogProduct[]> {
  try {
    return await Promise.all((await readRows(workspaceId)).map(present));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

/* ───────────────────────── discovery ───────────────────────── */

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: 8000,
      maxBytes: 4 * 1024 * 1024,
      onOverflow: "error",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) return null;
    return JSON.parse(res.text());
  } catch {
    return null;
  }
}

const page = (url: string, timeoutMs = 8000) =>
  fetchPublicText(url, {
    headers: { "User-Agent": USER_AGENT },
    timeoutMs,
    maxBytes: 3 * 1024 * 1024,
    requireTextContent: true,
  });

/** Run `fn` over `items`, `width` at a time. */
async function pooled<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += width)
    out.push(...(await Promise.all(items.slice(i, i + width).map(fn))));
  return out;
}

/** Products a website shows, best source first. Never throws; none found is an answer. */
export async function findWebsiteProducts(websiteUrl: string): Promise<CatalogCandidate[]> {
  const home = assertPublicUrl(websiteUrl);
  const origin = home.origin;

  // Shopify stores publish their catalogue; it is exact and needs no page reads.
  const shopify = parseShopifyProducts(await fetchJson(`${origin}/products.json?limit=30`), origin);
  if (shopify.length) return shopify.slice(0, STORE_PER_SCAN);

  const homeHtml = await page(home.toString(), 10_000);
  const links = homeHtml ? extractInternalLinks(homeHtml, home) : [];
  const sitemap = await page(`${origin}/sitemap.xml`, 5000);
  const nested = productSitemaps(sitemap);
  const nestedXml = await Promise.all(nested.map((u) => page(u, 5000)));
  const sitemapUrls = [sitemap, ...nestedXml].flatMap((xml) => parseSitemapUrls(xml, home, 200));
  const urls = productPageCandidates(home.toString(), links, sitemapUrls, SCAN_PAGE_LIMIT);

  const found = await pooled(urls, 4, async (url) => {
    const html = await page(url);
    return html ? candidateFromPage(parseProductPage(html, url)) : null;
  });
  return found.filter((p): p is CatalogCandidate => !!p);
}

/**
 * Download one product photo and store it in the workspace. Re-encoded so the
 * image model always gets a plain, reasonably sized JPEG or PNG.
 */
async function storePhoto(
  workspaceId: string,
  productUrl: string,
  images: string[],
): Promise<{ assetId: string; storagePath: string; sourceUrl: string } | null> {
  for (const src of images.slice(0, 3)) {
    try {
      const res = await safeFetch(assertPublicUrl(src), {
        timeoutMs: 15_000,
        maxBytes: MAX_IMAGE_BYTES,
        onOverflow: "error",
        headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
      });
      if (!res.ok || !/^image\//i.test(res.headers.get("content-type") ?? "image/")) continue;
      const image = sharp(Buffer.from(res.bytes), { failOn: "error" });
      const meta = await image.metadata();
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 300) continue;
      const alpha = !!meta.hasAlpha;
      const resized = image.rotate().resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      });
      const bytes = alpha
        ? await resized.png().toBuffer()
        : await resized.jpeg({ quality: 90 }).toBuffer();
      const key = createHash("sha256").update(`${productUrl}\n${src}`).digest("hex").slice(0, 32);
      const saved = await persistAsset({
        workspaceId,
        idempotencyKey: `product:${key}`,
        bytes,
        preserveBytes: true,
        assetType: "image",
        mimeType: alpha ? "image/png" : "image/jpeg",
        filename: `product-${key.slice(0, 12)}`,
        metadata: { source: "product_catalog", product_url: productUrl, image_url: src },
      });
      if (!saved.ok || !saved.asset.storage_path) continue;
      if (!isWorkspaceStoragePath(saved.asset.storage_path, workspaceId)) continue;
      return { assetId: saved.asset.id, storagePath: saved.asset.storage_path, sourceUrl: src };
    } catch (error) {
      log.info("products.photo_skipped", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/**
 * Find the brand's products and add the new ones. A product already in the
 * catalogue keeps its name and photo (a person may have fixed them); one a
 * person removed is never brought back.
 */
export async function discoverProducts(args: {
  workspaceId: string;
  userId: string;
  websiteUrl: string;
}): Promise<{ found: number; added: number; products: CatalogProduct[] }> {
  const existing = await readRows(args.workspaceId, true);
  const known = new Set(existing.map((row) => row.url));
  const active = existing.filter((row) => row.status === "active").length;
  const room = Math.max(0, MAX_PRODUCTS - active);
  const found = await findWebsiteProducts(args.websiteUrl);
  const fresh = found.filter((p) => !known.has(p.url)).slice(0, Math.min(room, STORE_PER_SCAN));

  const stored = await pooled(fresh, 4, async (product) => ({
    product,
    photo: await storePhoto(args.workspaceId, product.url, product.images),
  }));
  let position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const hasPrimary = existing.some((row) => row.is_primary && row.status === "active");
  const rows = stored
    .filter((s) => s.photo)
    .map((s, index) => ({
      workspace_id: args.workspaceId,
      name: s.product.name,
      url: s.product.url,
      price: s.product.price,
      description: s.product.description,
      category: s.product.category,
      image_asset_id: s.photo!.assetId,
      image_storage_path: s.photo!.storagePath,
      image_source_url: s.photo!.sourceUrl,
      source: "scan" as const,
      status: "active" as const,
      // The first product the site features becomes the main one.
      is_primary: !hasPrimary && index === 0,
      position: position++,
      created_by: args.userId,
    }));
  if (rows.length)
    checked(
      await db
        .from("workspace_products")
        .upsert(rows, { onConflict: "workspace_id,url", ignoreDuplicates: true }),
    );
  return {
    found: found.length,
    added: rows.length,
    products: await listProducts(args.workspaceId),
  };
}

/** Add one product from its page URL (a person's choice, so it may revive a removed one). */
export async function addProductFromUrl(args: {
  workspaceId: string;
  userId: string;
  url: string;
}): Promise<CatalogProduct[]> {
  const url = assertPublicUrl(args.url);
  url.hash = "";
  const html = await page(url.toString(), 12_000);
  if (!html) throw new HttpError(422, "We couldn't open that page. Check the link and try again.");
  const signals = parseProductPage(html, url.toString());
  const candidate = candidateFromPage({ ...signals, structured: true });
  if (!candidate)
    throw new HttpError(
      422,
      "We couldn't find a product photo on that page. Try its product page.",
    );
  const photo = await storePhoto(args.workspaceId, candidate.url, candidate.images);
  if (!photo) throw new HttpError(422, "The product photo on that page couldn't be saved.");
  const existing = await readRows(args.workspaceId, true);
  const active = existing.filter((row) => row.status === "active");
  if (active.length >= MAX_PRODUCTS && !active.some((row) => row.url === candidate.url))
    throw new HttpError(409, "Remove a product before adding another.");
  checked(
    await db.from("workspace_products").upsert(
      {
        workspace_id: args.workspaceId,
        name: candidate.name,
        url: candidate.url,
        price: candidate.price,
        description: candidate.description,
        category: candidate.category,
        image_asset_id: photo.assetId,
        image_storage_path: photo.storagePath,
        image_source_url: photo.sourceUrl,
        source: "manual",
        status: "active",
        is_primary: !active.some((row) => row.is_primary),
        position: existing.reduce((max, row) => Math.max(max, row.position), -1) + 1,
        created_by: args.userId,
      },
      { onConflict: "workspace_id,url" },
    ),
  );
  return listProducts(args.workspaceId);
}

/** Rename, remove, or make a product the main one. */
export async function updateProduct(args: {
  workspaceId: string;
  id: string;
  name?: string;
  status?: "active" | "removed";
  primary?: boolean;
}): Promise<CatalogProduct[]> {
  const row = checked(
    await db
      .from("workspace_products")
      .select("id,status")
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.id)
      .maybeSingle(),
  ) as { id: string; status: string } | null;
  if (!row) throw new HttpError(404, "This product is no longer in the catalogue.");
  if (args.primary) {
    // One main product: clear the old one first (the unique index guards the race).
    checked(
      await db
        .from("workspace_products")
        .update({ is_primary: false })
        .eq("workspace_id", args.workspaceId)
        .eq("is_primary", true),
    );
  }
  checked(
    await db
      .from("workspace_products")
      .update({
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.primary ? { is_primary: true, status: "active" } : {}),
        ...(args.status === "removed" ? { is_primary: false } : {}),
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.id),
  );
  return listProducts(args.workspaceId);
}

/* ───────────────────────── Studio ───────────────────────── */

/**
 * The product a Studio piece shows (`pickProduct`), read by the verified
 * workspace id. Never fails a job: no catalogue means no product.
 */
export async function productForJob(
  workspaceId: string,
  args: { chosen?: string | null; brief: string; type: string },
): Promise<JobProduct | null> {
  if (args.chosen === "none") return null;
  try {
    const rows = (await readRows(workspaceId)).filter(
      (row) =>
        row.image_storage_path && isWorkspaceStoragePath(row.image_storage_path, workspaceId),
    );
    const picked = pickProduct(
      rows.map((row) => ({ ...row, isPrimary: row.is_primary })),
      args,
    );
    if (!picked) return null;
    return {
      id: picked.id,
      name: picked.name,
      price: picked.price,
      description: picked.description,
      url: picked.url,
      storagePath: picked.image_storage_path,
    };
  } catch (error) {
    if (!missingTable(error)) console.warn("[products] catalogue unavailable for Studio", error);
    return null;
  }
}

/** A fresh signed URL for the product photo stored on a job, checked against its workspace. */
export async function productImageUrl(
  workspaceId: string,
  product: Pick<JobProduct, "storagePath"> | null | undefined,
): Promise<string | null> {
  if (!product?.storagePath || !isWorkspaceStoragePath(product.storagePath, workspaceId))
    return null;
  try {
    return (await signStoragePath(db, product.storagePath, 3600)) ?? null;
  } catch {
    return null;
  }
}
