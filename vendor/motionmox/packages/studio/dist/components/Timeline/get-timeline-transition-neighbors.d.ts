import type { TSequence } from '@motionmox/core';
export declare const getTimelineTransitionNeighbors: ({ sequenceId, sequences, }: {
    readonly sequenceId: string;
    readonly sequences: readonly TSequence[];
}) => {
    readonly previous: TSequence;
    readonly next: TSequence;
} | null;
