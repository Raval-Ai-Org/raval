import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type DreamyZoomProps = {
    rotation?: number;
    scale?: number;
};
export declare const dreamyZoomShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<DreamyZoomProps>>;
export declare const dreamyZoom: (props: DreamyZoomProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<DreamyZoomProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
