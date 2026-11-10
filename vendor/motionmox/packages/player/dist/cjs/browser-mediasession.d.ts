import type { VideoConfig } from '@motionmox/core';
export type BrowserMediaControlsBehavior = {
    mode: 'do-nothing';
} | {
    mode: 'prevent-media-session';
} | {
    mode: 'register-media-session';
};
export declare const useBrowserMediaSession: ({ browserMediaControlsBehavior, videoConfig, playbackRate, }: {
    browserMediaControlsBehavior: BrowserMediaControlsBehavior;
    videoConfig: VideoConfig | null;
    playbackRate: number;
}) => void;
