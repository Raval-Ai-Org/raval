import type { Caption } from '@motionmox/captions';
import type React from 'react';
export declare const CaptionPlayheadHighlight: React.FC<{
    readonly captions: Caption[];
    readonly getSequenceFrame: () => number;
    readonly containerRef: React.RefObject<HTMLDivElement | null>;
    readonly onInitialCaptionScrollRef: React.RefObject<(() => void) | null>;
}>;
