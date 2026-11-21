import type { EffectCatalogItem } from '@motionmox/studio-shared';
export declare const filterEffectCatalog: ({ items, query, }: {
    readonly items: readonly EffectCatalogItem[];
    readonly query: string;
}) => EffectCatalogItem[];
