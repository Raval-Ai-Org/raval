import { type InstallPackageResponse, type PackageInstallSpec } from '@motionmox/studio-shared';
export declare const installPackages: (dependencies: readonly PackageInstallSpec[]) => Promise<InstallPackageResponse>;
