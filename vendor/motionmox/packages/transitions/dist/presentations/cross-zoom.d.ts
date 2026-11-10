import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type CrossZoomProps = {
    strength?: number;
};
export declare const crossZoomShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<CrossZoomProps>>;
export declare const crossZoom: (props: CrossZoomProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<CrossZoomProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
