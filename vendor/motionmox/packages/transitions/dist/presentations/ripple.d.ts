import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type RippleProps = {
    amplitude?: number;
    speed?: number;
};
export declare const rippleShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<RippleProps>>;
export declare const ripple: (props: RippleProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<RippleProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
