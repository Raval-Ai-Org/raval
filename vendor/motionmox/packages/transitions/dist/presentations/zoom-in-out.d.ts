import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type ZoomInOutProps = Record<string, never>;
export declare const zoomInOutShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<ZoomInOutProps>>;
export declare const zoomInOut: (props: ZoomInOutProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<ZoomInOutProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
