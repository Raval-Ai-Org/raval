import type { TSequence } from '@motionmox/core';
export type TimelineTransitionRange = {
    readonly id: string;
    readonly from: number;
    readonly end: number;
};
export declare const getTimelineTransitionRangesByStart: (ranges: readonly TimelineTransitionRange[]) => ReadonlyMap<number, TimelineTransitionRange>;
export declare const getTimelineTransitionRanges: (items: readonly TSequence[]) => TimelineTransitionRange[];
