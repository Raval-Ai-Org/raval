type DestinationRect = {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
};
export declare const createRectTransformImplementations: <P>(label: string, getRect: (params: P, width: number, height: number) => DestinationRect) => {
    webgl2: import("@motionmox/core").EffectImplementation<P, unknown>;
    webgpu: import("@motionmox/core").EffectImplementation<P, unknown>;
};
export {};
