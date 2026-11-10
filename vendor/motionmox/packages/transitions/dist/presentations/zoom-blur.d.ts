import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type ZoomBlurProps = {
    rotation?: number;
};
export declare const zoomBlurShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<ZoomBlurProps>>;
export declare const zoomBlur: (props: ZoomBlurProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<ZoomBlurProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
