import type { DownloadBehavior } from '@motionmox/core';
export type EmittedArtifact = {
    filename: string;
    content: string | Uint8Array;
    frame: number;
    downloadBehavior: DownloadBehavior | null;
};
