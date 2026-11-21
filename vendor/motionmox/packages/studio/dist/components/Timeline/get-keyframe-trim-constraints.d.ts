import type { OverrideIdToNodePaths, PropStatuses, SequencePropsSubscriptionKey, TSequence } from '@motionmox/core';
export declare const getKeyframeTrimConstraints: ({ propStatuses, overrideIdsToNodePaths, sequences, affectedNodePaths, }: {
    propStatuses: PropStatuses;
    overrideIdsToNodePaths: OverrideIdToNodePaths;
    sequences: readonly TSequence[];
    affectedNodePaths: readonly SequencePropsSubscriptionKey[];
}) => PropStatuses;
