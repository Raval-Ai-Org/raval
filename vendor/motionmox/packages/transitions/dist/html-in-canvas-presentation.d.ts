import { type EffectsProp, type EffectsOutputSize } from '@motionmox/core';
import type { TransitionPresentation, TransitionPresentationComponentProps } from './types';
export declare const HtmlInCanvasPresentation: <TPassedProps extends Record<string, unknown>>(props: TransitionPresentationComponentProps<TPassedProps> & {
    readonly shader: HtmlInCanvasShader<TPassedProps>;
    readonly effects: EffectsProp | null;
    readonly effectsOutputSize: EffectsOutputSize | null;
}) => import("react").JSX.Element;
export type HtmlInCanvasShaderDrawParams<Props> = {
    prevImage: OffscreenCanvas | null;
    nextImage: OffscreenCanvas | null;
    width: number;
    height: number;
    time: number;
    passedProps: Props;
};
export type HtmlInCanvasShaderDraw<Props> = (params: HtmlInCanvasShaderDrawParams<Props>) => void;
export type HtmlInCanvasShader<Props> = (canvas: OffscreenCanvas) => {
    clear: () => void;
    cleanup: () => void;
    draw: HtmlInCanvasShaderDraw<Props>;
};
export declare const makeHtmlInCanvasPresentation: <TPassedProps extends Record<string, unknown>>(shader: HtmlInCanvasShader<TPassedProps>) => (props: TPassedProps & {
    effects?: EffectsProp;
    effectsOutputSize?: EffectsOutputSize;
}) => TransitionPresentation<TPassedProps & {
    effects?: EffectsProp;
    effectsOutputSize?: EffectsOutputSize;
}>;
