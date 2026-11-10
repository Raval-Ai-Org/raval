import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type CrosswarpProps = Record<string, never>;
export declare const crosswarpShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<CrosswarpProps>>;
export declare const crosswarp: (props: CrosswarpProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<CrosswarpProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
