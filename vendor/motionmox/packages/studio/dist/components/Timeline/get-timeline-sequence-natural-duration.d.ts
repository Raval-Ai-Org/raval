import type { TSequence } from '@motionmox/core';
export declare const getTimelineSequenceNaturalDuration: ({ sequence, sequences, }: {
    readonly sequence: TSequence;
    readonly sequences: readonly TSequence[];
}) => number | null;
