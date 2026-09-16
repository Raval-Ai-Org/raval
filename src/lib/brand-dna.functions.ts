"use client";

// Browser-facing surface for the `brand-dna` server functions
// (src/server/fns/brand-dna.ts).
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/brand-dna";

export const getBrandDna = serverFn<typeof Handlers.getBrandDna>("brand-dna/getBrandDna");
export const saveBrandDna = serverFn<typeof Handlers.saveBrandDna>("brand-dna/saveBrandDna");
