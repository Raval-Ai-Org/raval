import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import * as catalog from "@/server/products/catalog.server";

// The brand's product catalogue (Brain → Brand → Products). Finding products
// reads the brand's own website and calls no model, so it is included work.
const ws = { workspaceId: z.string().uuid() };

export const listProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    return { products: await catalog.listProducts(data.workspaceId) };
  });

export const discoverProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) => z.object({ ...ws, websiteUrl: z.string().url().max(2048) }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return catalog.discoverProducts({
      workspaceId: data.workspaceId,
      userId: context.userId,
      websiteUrl: data.websiteUrl,
    });
  });

export const addProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audit")])
  .inputValidator((data) => z.object({ ...ws, url: z.string().url().max(2048) }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return {
      products: await catalog.addProductFromUrl({
        workspaceId: data.workspaceId,
        userId: context.userId,
        url: data.url,
      }),
    };
  });

export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(160).optional(),
        status: z.enum(["active", "removed"]).optional(),
        primary: z.literal(true).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    return { products: await catalog.updateProduct(data) };
  });
