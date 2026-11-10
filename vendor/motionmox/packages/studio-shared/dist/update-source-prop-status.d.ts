import type { CanUpdateSequencePropSource, CanUpdateSequencePropStatus, VideoConfigValues } from '@motionmox/core';
export declare const updateSourcePropStatus: ({ source, videoConfigValues, update, }: {
    source: CanUpdateSequencePropSource;
    videoConfigValues: VideoConfigValues | null;
    update: (status: CanUpdateSequencePropStatus) => CanUpdateSequencePropStatus;
}) => CanUpdateSequencePropSource;
