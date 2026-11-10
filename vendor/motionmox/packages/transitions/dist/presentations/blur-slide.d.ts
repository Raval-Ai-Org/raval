import type { EffectsProp, EffectsOutputSize } from '@motionmox/core';
import type { HtmlInCanvasShader } from '../html-in-canvas-presentation';
import type { TransitionPresentation } from '../types';
import type { SlideDirection } from './slide';
export type BlurSlideDirection = SlideDirection;
export type BlurSlideProps = {
    direction?: BlurSlideDirection;
    blur?: number;
};
export declare const blurSlideShader: (canvas: OffscreenCanvas) => ReturnType<HtmlInCanvasShader<BlurSlideProps>>;
export declare const blurSlide: (props?: BlurSlideProps & {
    effects?: EffectsProp;
    effectsOutputSize?: EffectsOutputSize;
}) => TransitionPresentation<BlurSlideProps & {
    effects?: EffectsProp;
    effectsOutputSize?: EffectsOutputSize;
}>;
