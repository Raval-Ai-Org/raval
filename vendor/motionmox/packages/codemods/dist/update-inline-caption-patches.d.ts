import type { CaptionPatch } from '@motionmox/studio-shared';
import type { SequenceNodePath } from '@motionmox/core';
export declare const updateInlineCaptionPatches: ({ input, nodePath, patches, }: {
    input: string;
    nodePath: SequenceNodePath;
    patches: CaptionPatch[];
}) => {
    output: string;
    logLine: number;
    changedFields: string[][];
};
