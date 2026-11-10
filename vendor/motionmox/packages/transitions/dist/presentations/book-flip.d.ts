import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
export type BookFlipDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
export type BookFlipProps = {
    direction?: BookFlipDirection;
};
export declare const bookFlipShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<BookFlipProps>>;
export declare const bookFlip: (props: BookFlipProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}) => import("..").TransitionPresentation<BookFlipProps & {
    effects?: import("@motionmox/core").EffectsProp;
    effectsOutputSize?: import("@motionmox/core").EffectsOutputSize;
}>;
