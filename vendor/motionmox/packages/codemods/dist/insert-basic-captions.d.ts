import type { ElementInitialProps } from '@motionmox/studio-protocol';
import type { SequenceNodePathRemapping } from '@motionmox/studio-shared';
import type { SequenceNodePath } from '@motionmox/core';
export declare const insertBasicCaptions: ({ input, nodePath, captions, element, durationInFrames, importPath, prettierConfigOverride, }: {
    input: string;
    nodePath: SequenceNodePath;
    element: {
        componentName: string;
        initialProps: ElementInitialProps | null;
    } | null;
    captions: {
        text: string;
        startMs: number;
        endMs: number;
        timestampMs: number | null;
        confidence: number | null;
        pageBreakAfter?: boolean;
    }[];
    durationInFrames: number | null;
    importPath?: string;
    prettierConfigOverride?: Record<string, unknown> | null;
}) => {
    output: string;
    logLine: number;
    nodePathRemappings: SequenceNodePathRemapping[];
};
