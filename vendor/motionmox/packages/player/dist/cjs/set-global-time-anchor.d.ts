import { type LogLevel } from '@motionmox/core';
export declare const setGlobalTimeAnchor: ({ audioContext, audioSyncAnchor, absoluteTimeInSeconds, globalPlaybackRate, logLevel, force, }: {
    audioContext: AudioContext;
    audioSyncAnchor: {
        value: number;
    };
    absoluteTimeInSeconds: number;
    globalPlaybackRate: number;
    logLevel: LogLevel;
    force: boolean;
}) => boolean;
