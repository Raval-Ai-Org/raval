import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";
import { MAX_DISCOVERED, type Product } from "@/lib/products/catalog";

// The product catalogue (ADR-0035, src/server/products/). Reading needs
// membership; adding, editing and removing products need editor. Photos are
// uploaded through POST /api/products/photos.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const svc = () => import("@/server/products/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

/** What discovery returned, as the browser sends it back. Re-checked before use. */
const CandidateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1200).default(""),
  price: z.string().max(60).default(""),
  url: z.string().url().max(600).nullable(),
  category: z.string().max(80).default(""),
  images: z.array(z.string().url().max(1200)).max(3).default([]),
  source: z.enum(["scan", "shopify"]),
  fingerprint: z.string().min(1).max(200),
  kind: z.enum(["product", "service"]).optional(),
});

export const listProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }): Promise<Product[]> => {
    return (await svc()).listProducts(await caller(context, data.workspaceId, "viewer"));
  });

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z
      .object({ ...ws, id: uuid.optional(), product: z.record(z.string(), z.unknown()) })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<Product> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await svc()).saveProduct(c, { id: data.id, product: data.product });
  });

export const archiveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ ...ws, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await (await svc()).archiveProduct(await caller(context, data.workspaceId, "editor"), data.id);
    return { ok: true };
  });

export const reorderProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ ...ws, ids: z.array(uuid).max(200) }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await (
      await svc()
    ).reorderProducts(await caller(context, data.workspaceId, "editor"), data.ids);
    return { ok: true };
  });

/** Keep products found on the site; their photos are copied into Mellox storage. */
export const importProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("product-import")])
  .inputValidator((data) =>
    z.object({ ...ws, candidates: z.array(CandidateSchema).max(MAX_DISCOVERED) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<Product[]> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await svc()).importCandidates(c, data.candidates);
  });

export const updateProductPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z.object({ ...ws, id: uuid, remove: uuid.optional(), primary: uuid.optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<Product> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await svc()).updatePhotos(c, data.id, { remove: data.remove, primary: data.primary });
  });
