"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/products";
export const listProducts = serverFn<typeof Handlers.listProducts>("products/listProducts");
export const discoverProducts = serverFn<typeof Handlers.discoverProducts>(
  "products/discoverProducts",
);
export const addProduct = serverFn<typeof Handlers.addProduct>("products/addProduct");
export const updateProduct = serverFn<typeof Handlers.updateProduct>("products/updateProduct");
