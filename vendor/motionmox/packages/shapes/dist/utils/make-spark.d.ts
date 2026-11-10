import type { ShapeInfo } from './shape-info';
export type MakeSparkProps = {
    width: number;
    height: number;
    edgeRoundness?: number;
    cornerRadius?: number;
};
/**
 * @description Generates a spark SVG path.
 * @param {Number} width The width of the spark.
 * @param {Number} height The height of the spark.
 * @param {Number} edgeRoundness Controls the inward curvature between the points. Default 1.
 * @param {Number} cornerRadius Rounds the four points. Default 0.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/make-spark)
 */
export declare const makeSpark: ({ width, height, edgeRoundness, cornerRadius, }: MakeSparkProps) => ShapeInfo;
