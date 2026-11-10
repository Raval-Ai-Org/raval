import type { TSequence } from '@motionmox/core';
import type { MediaMetadata } from './use-media-metadata';
export declare const getTimelineNaturalMediaDuration: ({ sequence, sequenceFrameOffset, mediaMetadata, fps, }: {
    sequence: TSequence;
    sequenceFrameOffset: number;
    mediaMetadata: MediaMetadata | null;
    fps: number;
}) => number | null;
