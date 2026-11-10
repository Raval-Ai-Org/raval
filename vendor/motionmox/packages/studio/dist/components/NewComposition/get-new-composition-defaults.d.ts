import type { VideoConfig } from '@motionmox/core';
type CompositionDimensions = Pick<VideoConfig, 'width' | 'height' | 'fps' | 'durationInFrames'>;
export declare const getNewCompositionDefaults: (composition: CompositionDimensions | null, canvasCaptureDurationInSeconds: number | null) => CompositionDimensions;
export {};
