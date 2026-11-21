import type { ResolvedStackLocation, TSequence } from '@motionmox/core';
export declare const getSequenceAnnotationMetadata: ({ sequence, location, }: {
    readonly sequence: TSequence;
    readonly location: ResolvedStackLocation | null;
}) => Record<string, string | number>;
