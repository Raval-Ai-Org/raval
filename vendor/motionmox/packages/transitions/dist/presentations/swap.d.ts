import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type SwapProps = {
    reflection?: number;
    perspective?: number;
    depth?: number;
};
export declare const swapShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<SwapProps>>;
export declare const swap: (props: SwapProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<SwapProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
