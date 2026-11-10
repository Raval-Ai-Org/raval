import type { LoopVolumeCurveBehavior } from '@motionmox/core';
export declare const frameForVolumeProp: ({ behavior, loop, assetDurationInSeconds, fps, frame, startsAt, playbackRate, trimBefore, trimAfter, }: {
    behavior: LoopVolumeCurveBehavior;
    loop: boolean;
    assetDurationInSeconds: number | null;
    fps: number;
    frame: number;
    startsAt: number;
    playbackRate: number;
    trimBefore: number | undefined;
    trimAfter: number | undefined;
}) => number;
