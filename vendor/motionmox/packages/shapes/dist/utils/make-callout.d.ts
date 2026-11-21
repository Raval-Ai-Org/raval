import type { ShapeInfo } from './shape-info';
type PointerDirection = 'up' | 'down' | 'left' | 'right';
export type MakeCalloutProps = {
    width?: number;
    height?: number;
    pointerLength?: number;
    pointerBaseWidth?: number;
    pointerPosition?: number;
    pointerDirection?: PointerDirection;
    edgeRoundness?: number | null;
    cornerRadius?: number;
};
/**
 * @description Generates an SVG path for a callout shape.
 * @param {Number} width The width of the callout body. Default 500.
 * @param {Number} height The height of the callout body. Default 200.
 * @param {Number} pointerLength The length of the pointer. Default 40.
 * @param {Number} pointerBaseWidth The width of the pointer where it meets the body. Default 60.
 * @param {Number} pointerPosition Position of the pointer along its side, from 0 to 1. Default 0.5.
 * @param {string} pointerDirection The direction the pointer points. Default 'down'.
 * @param {null|Number} edgeRoundness Allows to modify the shape by rounding the edges using bezier curves. Default null.
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius. Cannot be used together with edgeRoundness.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/make-callout)
 */
export declare const makeCallout: ({ width, height, pointerLength, pointerBaseWidth, pointerPosition, pointerDirection, edgeRoundness, cornerRadius, }: MakeCalloutProps) => ShapeInfo;
export {};
