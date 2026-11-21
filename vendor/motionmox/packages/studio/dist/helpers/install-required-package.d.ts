import { type PackageInstallSpec } from '@motionmox/studio-shared';
export declare const getMissingPackages: (dependencies: readonly PackageInstallSpec[]) => PackageInstallSpec[];
export declare const installRequiredPackages: (dependencies: readonly PackageInstallSpec[]) => Promise<void>;
