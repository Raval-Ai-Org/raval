// service.server.ts — the brand's product catalogue (ADR-0035). Callers
// (src/server/fns/products.ts, the photo route) have already checked the
// workspace role; writes here use the service role for that one workspace.
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  MAX_DISCOVERED,
  MAX_IMAGES_PER_CANDIDATE,
  MAX_PRODUCT_IMAGES,
  decideProduct,
  type Product,
  type ProductCandidate,
} from "@/lib/products/catalog";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { signAssetPath } from "@/server/assets/persist.server";
import { importImageFromUrl, storeUploadedImage } from "@/server/assets/reference-image.server";
import { HttpError } from "@/server/http-error";
import type { WorkspaceRole } from "@/server/api-auth";
import { invalidateProductContext } from "./context.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "workspace_products";
const COLUMNS =
  "id, workspace_id, kind, name, description, price, url, category, benefits, image_asset_ids, primary_asset_id, source, position, status";

export type ProductCaller = { workspaceId: string; userId: string; role: WorkspaceRole };

export type ProductRow = {
  id: string;
  workspace_id: string;
  kind: Product["kind"];
  name: string;
  description: string;
  price: string;
  url: string | null;
  category: string;
  benefits: string[] | null;
  image_asset_ids: string[] | null;
  primary_asset_id: string | null;
  source: Product["source"];
  position: number;
  status: Product["status"];
};

type AssetRow = {
  id: string;
  workspace_id: string;
  storage_path: string | null;
  status: string;
  asset_type: string;
  deleted_at: string | null;
};

const changed = (workspaceId: string) => invalidateProductContext(workspaceId);

/** Image assets that really belong to this workspace, by id. */
async function workspaceImages(workspaceId: string, ids: string[]): Promise<Map<string, AssetRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await db
    .from("assets")
    .select("id, workspace_id, storage_path, status, asset_type, deleted_at")
    .eq("workspace_id", workspaceId)
    .in("id", unique);
  if (error) throw new HttpError(503, "Could not load product photos.");
  return new Map(
    ((data ?? []) as AssetRow[])
      .filter(
        (a) =>
          a.asset_type === "image" &&
          a.status === "ready" &&
          !a.deleted_at &&
          isWorkspaceStoragePath(a.storage_path, workspaceId),
      )
      .map((a) => [a.id, a]),
  );
}

async function present(workspaceId: string, rows: ProductRow[]): Promise<Product[]> {
  const images = await workspaceImages(
    workspaceId,
    rows.flatMap((r) => r.image_asset_ids ?? []),
  );
  const signed = new Map<string, string | null>();
  await Promise.all(
    [...images.values()].map(async (a) => signed.set(a.id, await signAssetPath(a.storage_path))),
  );
  return rows.map((r) => {
    const own = (r.image_asset_ids ?? []).filter((id) => images.has(id));
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      description: r.description,
      price: r.price,
      url: r.url,
      category: r.category,
      benefits: r.benefits ?? [],
      images: own.map((assetId) => ({ assetId, url: signed.get(assetId) ?? null })),
      primaryAssetId:
        r.primary_asset_id && own.includes(r.primary_asset_id)
          ? r.primary_asset_id
          : (own[0] ?? null),
      source: r.source,
      position: r.position,
      status: r.status,
    };
  });
}

export async function readProductRows(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ProductRow[]> {
  let q = db.from(TABLE).select(COLUMNS).eq("workspace_id", workspaceId);
  if (!opts.includeArchived) q = q.eq("status", "active");
  const { data, error } = await q.order("position").order("created_at").limit(200);
  if (error) throw new HttpError(503, "Could not load your products.");
  return (data ?? []) as ProductRow[];
}

export async function readProductRow(workspaceId: string, id: string): Promise<ProductRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not load that product.");
  return (data as ProductRow | null) ?? null;
}

export async function listProducts(caller: ProductCaller): Promise<Product[]> {
  return present(caller.workspaceId, await readProductRows(caller.workspaceId));
}

async function nextPosition(workspaceId: string): Promise<number> {
  const { data } = await db
    .from(TABLE)
    .select("position")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { position?: number } | null)?.position ?? -1) + 1;
}

async function one(caller: ProductCaller, id: string): Promise<Product> {
  const row = await readProductRow(caller.workspaceId, id);
  if (!row) throw new HttpError(404, "That product is no longer here.");
  return (await present(caller.workspaceId, [row]))[0];
}

/** Add a product, or save edits to one. The same product added twice is one row. */
export async function saveProduct(
  caller: ProductCaller,
  args: { id?: string; product: unknown },
): Promise<Product> {
  const decision = decideProduct(args.product);
  if (!decision.ok) throw new HttpError(400, decision.error);
  const { input, fingerprint } = decision;
  const values = {
    kind: input.kind,
    name: input.name,
    description: input.description,
    price: input.price,
    url: input.url ?? null,
    category: input.category,
    benefits: input.benefits,
  };
  if (args.id) {
    const { data, error } = await db
      .from(TABLE)
      .update({ ...values, fingerprint, status: "active" })
      .eq("workspace_id", caller.workspaceId)
      .eq("id", args.id)
      .select("id")
      .maybeSingle();
    if (error?.code === "23505")
      throw new HttpError(409, "You already have a product with that name or page.");
    if (error) throw new HttpError(503, "Could not save that product.");
    if (!data) throw new HttpError(404, "That product is no longer here.");
    changed(caller.workspaceId);
    return one(caller, args.id);
  }
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        ...values,
        workspace_id: caller.workspaceId,
        fingerprint,
        source: "manual",
        status: "active",
        position: await nextPosition(caller.workspaceId),
        created_by: caller.userId,
      },
      { onConflict: "workspace_id,fingerprint" },
    )
    .select("id")
    .single();
  if (error || !data) throw new HttpError(503, "Could not add that product.");
  changed(caller.workspaceId);
  return one(caller, (data as { id: string }).id);
}

export async function archiveProduct(caller: ProductCaller, id: string): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ status: "archived" })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", id);
  if (error) throw new HttpError(503, "Could not remove that product.");
  changed(caller.workspaceId);
}

export async function reorderProducts(caller: ProductCaller, ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, position) =>
      db.from(TABLE).update({ position }).eq("workspace_id", caller.workspaceId).eq("id", id),
    ),
  );
  changed(caller.workspaceId);
}

async function setImages(
  caller: ProductCaller,
  row: ProductRow,
  imageIds: string[],
  primary: string | null,
): Promise<void> {
  const ids = [...new Set(imageIds)].slice(0, MAX_PRODUCT_IMAGES);
  const { error } = await db
    .from(TABLE)
    .update({
      image_asset_ids: ids,
      primary_asset_id: primary && ids.includes(primary) ? primary : (ids[0] ?? null),
    })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id);
  if (error) throw new HttpError(503, "Could not save the photo.");
  changed(caller.workspaceId);
}

const imageKey = (productId: string, url: string) =>
  `product-img:${productId}:${createHash("sha1").update(url).digest("hex")}`;

/**
 * Keep the products a person chose from discovery. Their photos are copied
 * into Mellox storage; a photo that can't be downloaded is skipped, never fatal.
 */
export async function importCandidates(
  caller: ProductCaller,
  candidates: ProductCandidate[],
): Promise<Product[]> {
  let position = await nextPosition(caller.workspaceId);
  const kept: string[] = [];
  for (const c of candidates.slice(0, MAX_DISCOVERED)) {
    const decision = decideProduct({
      kind: "product",
      name: c.name,
      description: c.description,
      price: c.price,
      url: c.url,
      category: c.category,
    });
    if (!decision.ok) continue;
    const { data, error } = await db
      .from(TABLE)
      .upsert(
        {
          workspace_id: caller.workspaceId,
          kind: "product",
          name: decision.input.name,
          description: decision.input.description,
          price: decision.input.price,
          url: decision.input.url ?? null,
          category: decision.input.category,
          fingerprint: decision.fingerprint,
          source: c.source === "shopify" ? "shopify" : "scan",
          status: "active",
          position: position++,
          created_by: caller.userId,
        },
        { onConflict: "workspace_id,fingerprint" },
      )
      .select(COLUMNS)
      .single();
    if (error || !data) continue;
    const row = data as ProductRow;
    kept.push(row.id);
    const stored = await Promise.all(
      c.images.slice(0, MAX_IMAGES_PER_CANDIDATE).map((url) =>
        importImageFromUrl(caller.workspaceId, url, {
          source: "product-photo",
          idempotencyKey: imageKey(row.id, url),
          metadata: { product_id: row.id },
        }).catch(() => null),
      ),
    );
    const ids = stored.filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.assetId);
    if (ids.length)
      await setImages(caller, row, [...(row.image_asset_ids ?? []), ...ids], row.primary_asset_id);
  }
  changed(caller.workspaceId);
  const rows = await readProductRows(caller.workspaceId);
  return present(caller.workspaceId, rows);
}

/** A photo a person uploaded for one product. */
export async function addUploadedPhoto(
  caller: ProductCaller,
  productId: string,
  file: File,
): Promise<{ product: Product; lowResolution: boolean }> {
  const row = await readProductRow(caller.workspaceId, productId);
  if (!row || row.status !== "active") throw new HttpError(404, "That product is no longer here.");
  if ((row.image_asset_ids ?? []).length >= MAX_PRODUCT_IMAGES)
    throw new HttpError(409, `A product can have up to ${MAX_PRODUCT_IMAGES} photos.`);
  const { LOW_RESOLUTION_PX } = await import("@/server/assets/reference-image.server");
  const stored = await storeUploadedImage(caller.workspaceId, file, {
    source: "product-photo",
    metadata: { product_id: row.id },
  });
  // A person's upload becomes the main photo: it's the one they chose.
  await setImages(caller, row, [stored.assetId, ...(row.image_asset_ids ?? [])], stored.assetId);
  return {
    product: await one(caller, productId),
    lowResolution: Math.min(stored.width, stored.height) < LOW_RESOLUTION_PX,
  };
}

export async function updatePhotos(
  caller: ProductCaller,
  productId: string,
  args: { remove?: string; primary?: string },
): Promise<Product> {
  const row = await readProductRow(caller.workspaceId, productId);
  if (!row) throw new HttpError(404, "That product is no longer here.");
  const ids = (row.image_asset_ids ?? []).filter((id) => id !== args.remove);
  await setImages(caller, row, ids, args.primary ?? row.primary_asset_id);
  return one(caller, productId);
}

/**
 * A product for a generator, checked against the workspace: the row must be
 * this workspace's and active, and its photo a ready image in its storage.
 */
export async function productForGeneration(
  workspaceId: string,
  productId: string,
): Promise<(ProductRow & { photoAssetId: string | null }) | null> {
  const row = await readProductRow(workspaceId, productId);
  if (!row || row.status !== "active") return null;
  const candidate = row.primary_asset_id ?? row.image_asset_ids?.[0] ?? null;
  const ok = candidate ? (await workspaceImages(workspaceId, [candidate])).has(candidate) : false;
  return { ...row, photoAssetId: ok ? candidate : null };
}
