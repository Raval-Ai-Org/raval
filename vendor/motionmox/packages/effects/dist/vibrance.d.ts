export type VibranceParams = {
    /** Vibrance adjustment from `-1` to `1`. Defaults to `0`. */
    readonly amount?: number;
};
export declare const vibrance: (params?: (VibranceParams & {
    readonly disabled?: boolean;
}) | undefined) => import("@motionmox/core").EffectDescriptor<unknown>;
