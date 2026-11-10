import type { ArtifactAsset } from '@motionmox/core/no-react';
import type { Page } from './browser/BrowserPage';
export declare const collectAssets: ({ frame, freePage, timeoutInMilliseconds, }: {
    frame: number;
    freePage: Page;
    timeoutInMilliseconds: number;
}) => Promise<(import("@motionmox/core/no-react").InlineAudioAsset | ArtifactAsset | import("@motionmox/core/no-react").AudioOrVideoAsset)[]>;
