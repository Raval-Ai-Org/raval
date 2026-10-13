"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/brand-visuals";
export const restoreManualVisualLook = serverFn<typeof Handlers.restoreManualVisualLook>(
  "brand-visuals/restoreManualVisualLook",
);
export const getVisualTaste = serverFn<typeof Handlers.getVisualTaste>(
  "brand-visuals/getVisualTaste",
);
export const editVisualArtwork = serverFn<typeof Handlers.editVisualArtwork>(
  "brand-visuals/editVisualArtwork",
);
export const learnVisualReferences = serverFn<typeof Handlers.learnVisualReferences>(
  "brand-visuals/learnVisualReferences",
);
export const scanVisualWebsite = serverFn<typeof Handlers.scanVisualWebsite>(
  "brand-visuals/scanVisualWebsite",
);
export const addVisualReference = serverFn<typeof Handlers.addVisualReference>(
  "brand-visuals/addVisualReference",
);
export const updateVisualReference = serverFn<typeof Handlers.updateVisualReference>(
  "brand-visuals/updateVisualReference",
);
export const saveVisualDirection = serverFn<typeof Handlers.saveVisualDirection>(
  "brand-visuals/saveVisualDirection",
);
export const giveVisualFeedback = serverFn<typeof Handlers.giveVisualFeedback>(
  "brand-visuals/giveVisualFeedback",
);
export const cancelVisualScan = serverFn<typeof Handlers.cancelVisualScan>(
  "brand-visuals/cancelVisualScan",
);
