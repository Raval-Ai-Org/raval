import React from 'react';
import { type InteractivitySchema } from '@motionmox/core';
export declare const videoSchema: InteractivitySchema;
export declare const Video: React.ComponentType<{
    src: string;
} & Partial<{
    trimBefore: number | undefined;
    trimAfter: number | undefined;
}> & Partial<{
    className: string | undefined;
    volume: import("@motionmox/core").VolumeProp;
    loopVolumeCurveBehavior: import("@motionmox/core").LoopVolumeCurveBehavior;
    onVideoFrame: import("@motionmox/core").OnVideoFrame | undefined;
    playbackRate: number;
    preservePitch: boolean;
    muted: boolean;
    delayRenderRetries: number | null;
    delayRenderTimeoutInMilliseconds: number | null;
    style: React.CSSProperties;
    logLevel: import("@motionmox/core").LogLevel;
    loop: boolean;
    audioStreamIndex: number;
    disallowFallbackToOffthreadVideo: boolean;
    fallbackOffthreadVideoProps: import("./props").FallbackOffthreadVideoProps;
    trimAfter: number | undefined;
    trimBefore: number | undefined;
    toneFrequency: number;
    showInTimeline: boolean;
    debugOverlay: boolean;
    headless: boolean;
    onError: import("../on-error").MediaOnError | undefined;
    credentials: RequestCredentials | undefined;
    requestInit: import("..").MediaRequestInit | undefined;
    objectFit: import("./props").VideoObjectFit;
    maxCanvasSinkFrameSize: import("./props").MaxCanvasSinkFrameSize | null;
    _experimentalInitiallyDrawCachedFrame: boolean;
    effects: import("@motionmox/core").EffectsProp;
    effectsOutputSize: import("@motionmox/core").EffectsOutputSize | null;
}> & Omit<React.HTMLAttributes<HTMLElement>, "_experimentalInitiallyDrawCachedFrame" | "audioStreamIndex" | "className" | "credentials" | "debugOverlay" | "delayRenderRetries" | "delayRenderTimeoutInMilliseconds" | "disallowFallbackToOffthreadVideo" | "effects" | "effectsOutputSize" | "fallbackOffthreadVideoProps" | "headless" | "logLevel" | "loop" | "loopVolumeCurveBehavior" | "maxCanvasSinkFrameSize" | "muted" | "objectFit" | "onError" | "onVideoFrame" | "playbackRate" | "preservePitch" | "requestInit" | "showInTimeline" | "src" | "style" | "toneFrequency" | "trimAfter" | "trimBefore" | "volume"> & Record<`data-${string}`, string | undefined> & import("@motionmox/core").InteractiveBaseProps & import("@motionmox/core").InteractiveCropProps & import("@motionmox/core").InteractivePremountProps>;
