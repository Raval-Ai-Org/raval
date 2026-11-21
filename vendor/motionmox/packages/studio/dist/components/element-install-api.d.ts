import type { InsertElementRequest, InsertElementResponse, PrepareElementInstallRequest, PrepareElementInstallResponse } from '@motionmox/studio-shared';
export declare const prepareElementInstall: (request: PrepareElementInstallRequest) => Promise<PrepareElementInstallResponse>;
export declare const installElement: (request: InsertElementRequest) => Promise<InsertElementResponse>;
