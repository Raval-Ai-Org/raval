import { type BrowserStudioOperations } from '@motionmox/studio-shared';
export declare const BROWSER_STUDIO_OPERATIONS_READY_EVENT = "remotion-browser-studio-operations-ready";
export declare const getBrowserStudioOperations: () => BrowserStudioOperations | null;
export declare const getBrowserStudioKeyframeOperations: () => import("@motionmox/studio-shared").BrowserStudioKeyframeOperations | null;
export declare const getBrowserStudioEffectOperations: () => import("@motionmox/studio-shared").BrowserStudioEffectOperations | null;
export declare const canUseKeyframeOperations: () => boolean;
export declare const canUseEffectOperations: () => boolean;
export declare const canInstallPackages: () => boolean;
