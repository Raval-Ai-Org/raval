"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Canva from "@/server/fns/canva";
export const getCanvaConnection = serverFn<typeof Canva.getCanvaConnection>(
  "canva/getCanvaConnection",
);
export const startCanvaConnect =
  serverFn<typeof Canva.startCanvaConnect>("canva/startCanvaConnect");
export const completeCanvaConnect = serverFn<typeof Canva.completeCanvaConnect>(
  "canva/completeCanvaConnect",
);
export const removeCanvaConnection = serverFn<typeof Canva.removeCanvaConnection>(
  "canva/removeCanvaConnection",
);
export const createCanvaEdit = serverFn<typeof Canva.createCanvaEdit>("canva/createCanvaEdit");
export const getCanvaEditState =
  serverFn<typeof Canva.getCanvaEditState>("canva/getCanvaEditState");
export const importCanvaVersion = serverFn<typeof Canva.importCanvaVersion>(
  "canva/importCanvaVersion",
);
export const selectCanvaVersionAction = serverFn<typeof Canva.selectCanvaVersionAction>(
  "canva/selectCanvaVersionAction",
);
