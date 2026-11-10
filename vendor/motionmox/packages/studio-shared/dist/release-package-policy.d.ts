export declare const packagesRemovedInV5: readonly ['@motionmox/light-leaks', '@motionmox/media-parser', '@motionmox/starburst', '@motionmox/webcodecs', '@motionmox/whisper-web'];
export declare const shouldReleasePackage: ({ packageName, releaseVersion, }: {
    packageName: string;
    releaseVersion: string;
}) => boolean;
type PackageJsonWithDependencies = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};
type PackageJsonForRelease<T> = Omit<T, 'dependencies' | 'devDependencies'> & PackageJsonWithDependencies;
export declare const moveRemovedDependenciesToDevDependencies: <T extends PackageJsonWithDependencies>({ packageJson, releaseVersion, }: {
    packageJson: T;
    releaseVersion: string;
}) => PackageJsonForRelease<T>;
export {};
