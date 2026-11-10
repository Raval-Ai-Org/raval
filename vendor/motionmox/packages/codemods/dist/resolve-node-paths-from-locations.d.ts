import type { SequenceNodePath } from '@motionmox/core';
export declare const resolveNodePathsFromLocations: ({ fileContents, targets, }: {
    fileContents: string;
    targets: {
        line: number;
        column: number;
    }[];
}) => (SequenceNodePath | null)[];
