import { type EffectCatalogItem } from '@motionmox/studio-shared';
import React from 'react';
export declare const EffectThumbnail: React.FC<{
    readonly item: EffectCatalogItem;
    readonly snapshot: HTMLCanvasElement | null;
    readonly isScrolling: boolean;
}>;
