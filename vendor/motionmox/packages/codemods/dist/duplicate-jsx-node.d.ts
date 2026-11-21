import type { SequenceNodePathRemapping } from '@motionmox/studio-shared';
import type { SequenceNodePath } from '@motionmox/core';
export declare const duplicateNodes: ({ input, nodePaths, }: {
    input: string;
    nodePaths: SequenceNodePath[];
}) => Promise<{
    output: string;
    formatted: boolean;
    nodeLabels: string[];
    logLines: number[];
    nodePathRemappings: SequenceNodePathRemapping[];
    duplicatedNodePaths: SequenceNodePath[];
}>;
