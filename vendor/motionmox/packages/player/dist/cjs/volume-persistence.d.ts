import { type LogLevel } from '@motionmox/core';
export declare const persistVolume: (volume: number, logLevel: LogLevel, volumePersistenceKey: string | null) => void;
export declare const getPreferredVolume: (volumePersistenceKey: string | null) => number;
