import { type LogLevel } from '@motionmox/core';
export type BackgroundKeepalive = {
    waitForTick: () => Promise<void>;
    [Symbol.dispose]: () => void;
};
export declare function createBackgroundKeepalive({ fps, logLevel, }: {
    fps: number;
    logLevel: LogLevel;
}): BackgroundKeepalive;
