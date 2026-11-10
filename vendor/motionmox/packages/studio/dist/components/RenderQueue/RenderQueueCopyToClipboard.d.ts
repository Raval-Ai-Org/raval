import type { RenderJob } from '@motionmox/studio-shared';
export declare const supportsCopyingToClipboard: (job: RenderJob) => boolean;
export declare const RenderQueueCopyToClipboard: React.FC<{
    job: RenderJob;
}>;
