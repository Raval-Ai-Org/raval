import type { ElementInstallRequest } from '@motionmox/studio-shared';
export declare const enqueueElementInstallRequest: (request: ElementInstallRequest) => void;
export declare const subscribeToElementInstallRequests: (listener: (request: ElementInstallRequest) => void) => () => void;
