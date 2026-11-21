import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type LinearBlurProps = {
    intensity?: number;
};
export declare const linearBlurShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<LinearBlurProps>>;
export declare const linearBlur: (props: LinearBlurProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<LinearBlurProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
