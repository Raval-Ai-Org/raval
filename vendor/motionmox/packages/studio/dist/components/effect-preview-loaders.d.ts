import type { EffectDescriptor } from '@motionmox/core';
export type EffectPreviewFactory = (params: Record<string, unknown>) => EffectDescriptor<unknown>;
export declare const effectPreviewLoaders: Record<string, () => Promise<Record<string, unknown>>>;
