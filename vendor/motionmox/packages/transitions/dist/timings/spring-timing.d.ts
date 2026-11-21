import type { SpringConfig } from '@motionmox/core';
import type { TransitionTiming } from '../types.js';
export declare const springTiming: (options?: {
    config?: Partial<SpringConfig>;
    durationInFrames?: number;
    durationRestThreshold?: number;
    reverse?: boolean;
}) => TransitionTiming;
