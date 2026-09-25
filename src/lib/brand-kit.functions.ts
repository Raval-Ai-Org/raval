"use client";

// Browser-facing surface for the `brand-kit` server functions (Brand Kit and
// Styles). RPC stubs dispatched to /api/rpc/brand-kit/<name>; the
// implementations live in src/server/fns/brand-kit.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/brand-kit";

export const getBrandKit = serverFn<typeof Handlers.getBrandKit>("brand-kit/getBrandKit");
export const listStyleOptions = serverFn<typeof Handlers.listStyleOptions>(
  "brand-kit/listStyleOptions",
);
export const createStyle = serverFn<typeof Handlers.createStyle>("brand-kit/createStyle");
export const updateStyle = serverFn<typeof Handlers.updateStyle>("brand-kit/updateStyle");
export const duplicateStyle = serverFn<typeof Handlers.duplicateStyle>("brand-kit/duplicateStyle");
export const archiveStyle = serverFn<typeof Handlers.archiveStyle>("brand-kit/archiveStyle");
export const setDefaultStyle = serverFn<typeof Handlers.setDefaultStyle>(
  "brand-kit/setDefaultStyle",
);
export const startKitUpload = serverFn<typeof Handlers.startKitUpload>("brand-kit/startKitUpload");
export const finishKitUpload = serverFn<typeof Handlers.finishKitUpload>(
  "brand-kit/finishKitUpload",
);
export const addWritingSample = serverFn<typeof Handlers.addWritingSample>(
  "brand-kit/addWritingSample",
);
export const updateKitAsset = serverFn<typeof Handlers.updateKitAsset>("brand-kit/updateKitAsset");
export const deleteKitAsset = serverFn<typeof Handlers.deleteKitAsset>("brand-kit/deleteKitAsset");
export const analyzeKitAssets = serverFn<typeof Handlers.analyzeKitAssets>(
  "brand-kit/analyzeKitAssets",
);
export const suggestStyle = serverFn<typeof Handlers.suggestStyle>("brand-kit/suggestStyle");
export const describeStyle = serverFn<typeof Handlers.describeStyle>("brand-kit/describeStyle");
export const previewStylePrompt = serverFn<typeof Handlers.previewStylePrompt>(
  "brand-kit/previewStylePrompt",
);
