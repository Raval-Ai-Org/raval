import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type DissolveProps = {
    lineWidth?: number;
    spreadColor?: string;
    hotColor?: string;
    pow?: number;
    intensity?: number;
};
export declare const dissolveShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<DissolveProps>>;
export declare const dissolve: (props: DissolveProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<DissolveProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
