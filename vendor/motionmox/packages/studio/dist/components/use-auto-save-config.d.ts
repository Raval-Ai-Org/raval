import type { ConfigUpdate } from '@motionmox/studio-shared';
export declare const useAutoSaveConfig: ({ enabled, onError, ready, syncRevision, updates, }: {
    readonly enabled: boolean;
    readonly onError: (error: string | null) => void;
    readonly ready: boolean;
    readonly syncRevision: number;
    readonly updates: ConfigUpdate[];
}) => void;
