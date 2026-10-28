"use client";

// Browser-facing surface for the `products` server functions (ADR-0035). RPC
// stubs dispatched to /api/rpc/products/<name>; the implementations live in
// src/server/fns/products.ts. Photos upload through POST /api/products/photos.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/products";

export const listProducts = serverFn<typeof Handlers.listProducts>("products/listProducts");
export const saveProduct = serverFn<typeof Handlers.saveProduct>("products/saveProduct");
export const archiveProduct = serverFn<typeof Handlers.archiveProduct>("products/archiveProduct");
export const reorderProducts = serverFn<typeof Handlers.reorderProducts>(
  "products/reorderProducts",
);
export const importProducts = serverFn<typeof Handlers.importProducts>("products/importProducts");
export const updateProductPhotos = serverFn<typeof Handlers.updateProductPhotos>(
  "products/updateProductPhotos",
);
