import type { TRenderAsset } from '@motionmox/core';
export declare const createAudioMixer: ({ fps, sampleRate, }: {
    fps: number;
    sampleRate: number;
}) => {
    addFrame: ({ assets, timestamp, isLastFrame, }: {
        assets: TRenderAsset[];
        timestamp: number;
        isLastFrame: boolean;
    }) => void;
    getReadyAudio: () => AudioData | null;
};
