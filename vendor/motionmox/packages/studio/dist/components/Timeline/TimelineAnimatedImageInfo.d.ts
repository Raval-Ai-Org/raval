import type { TimelineLoopDisplay } from '@motionmox/sdk';
import React from 'react';
import type { TSequence } from '@motionmox/core';
export declare const TimelineAnimatedImageInfo: React.FC<{
    readonly sequence: Extract<TSequence, {
        type: 'image';
    }>;
    readonly sequenceFrameOffset: number;
    readonly displayOffsetInFrames: number;
    readonly displayDurationInFrames: number;
    readonly visualizationWidth: number;
    readonly loopDisplay: TimelineLoopDisplay | null;
    readonly fps: number;
}>;
