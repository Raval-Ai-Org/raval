export declare const createColorMatrixImplementations: <P>(label: string, getUniformData: (params: P) => Float32Array<ArrayBuffer>) => {
    webgl2: import("@motionmox/core").EffectImplementation<P, unknown>;
    webgpu: import("@motionmox/core").EffectImplementation<P, unknown>;
};
