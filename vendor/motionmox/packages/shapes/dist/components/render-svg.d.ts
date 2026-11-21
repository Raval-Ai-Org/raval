import type { Instruction } from '@motionmox/paths';
import React from 'react';
import { type EffectsProp, type EffectsOutputSize, type HtmlInCanvasPixelDensity, type InteractiveBaseProps, type InteractivePremountProps, type SequenceControls } from '@motionmox/core';
type ShapeSequenceProps = InteractiveBaseProps & InteractivePremountProps & {
    readonly controls?: SequenceControls;
};
export type AllShapesProps = Omit<React.SVGProps<SVGPathElement>, 'width' | 'height' | 'd' | 'hidden' | 'name'> & ShapeSequenceProps & {
    readonly debug?: boolean;
    readonly effects?: EffectsProp;
    readonly effectsOutputSize?: EffectsOutputSize;
    readonly pathStyle?: React.CSSProperties;
    readonly pixelDensity?: HtmlInCanvasPixelDensity;
};
export declare const RenderSvg: ({ defaultName, documentationLink, width, height, path, style, pathStyle, transformOrigin, debug, effects, effectsOutputSize, instructions, pixelDensity, durationInFrames, from, premountFor, postmountFor, styleWhilePremounted, styleWhilePostmounted, trimBefore, playbackRate, loop, freeze, hidden, name, showInTimeline, controls, ...props }: {
    readonly defaultName: string;
    readonly documentationLink: string;
    readonly width: number;
    readonly height: number;
    readonly path: string;
    readonly instructions: Instruction[];
    readonly transformOrigin: string;
} & AllShapesProps) => React.JSX.Element;
export {};
