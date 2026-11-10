import type { ReorderSequencePosition, SequenceNodePathRemapping } from '@motionmox/studio-shared';
import type { SequenceNodePath } from '@motionmox/core';
export declare const reorderSequences: ({ input, sourceNodePaths, targetNodePath, position, }: {
    input: string;
    sourceNodePaths: readonly SequenceNodePath[];
    targetNodePath: SequenceNodePath;
    position: ReorderSequencePosition;
}) => {
    output: string;
    formatted: boolean;
    sequenceLabel: string;
    logLine: number;
    nodePathRemappings: SequenceNodePathRemapping[];
};
