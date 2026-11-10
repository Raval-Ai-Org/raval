export type PixelateParams = {
    readonly blockSize?: number;
};
export declare const pixelate: (params?: (PixelateParams & {
    readonly disabled?: boolean;
}) | undefined) => import("@motionmox/core").EffectDescriptor<unknown>;
