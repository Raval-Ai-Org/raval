import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type FilmBurnProps = {
    seed?: number;
};
export declare const filmBurnShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<FilmBurnProps>>;
export declare const filmBurn: (props: FilmBurnProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<FilmBurnProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
