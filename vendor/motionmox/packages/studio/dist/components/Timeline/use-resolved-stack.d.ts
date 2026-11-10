import type { ResolvedStackLocation } from '@motionmox/core';
export declare const hasResolvedStack: (stack: string | null) => boolean;
export declare const getCachedResolvedStack: (stack: string | null) => ResolvedStackLocation | null;
export declare const useResolvedStack: (stack: string | null) => ResolvedStackLocation | null;
