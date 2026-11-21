"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spark = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_spark_1 = require("../utils/make-spark");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const sparkSchema = (0, schema_1.makeShapeSchema)({
    width: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Width',
        min: 0,
    }),
    height: (0, schema_1.numberField)({
        defaultValue: 140,
        description: 'Height',
        min: 0,
    }),
    edgeRoundness: (0, schema_1.numberField)({
        defaultValue: 1,
        description: 'Edge Roundness',
        min: 0,
        step: 0.01,
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element containing a spark.
 * @param {Number} width The width of the spark.
 * @param {Number} height The height of the spark.
 * @param {Number} edgeRoundness Controls the inward curvature between the points. Default 1.
 * @param {Number} cornerRadius Rounds the four points. Default 0.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/spark)
 */
const SparkInner = ({ width, height, edgeRoundness, cornerRadius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Spark>", documentationLink: "https://www.remotion.dev/docs/shapes/spark", ...(0, make_spark_1.makeSpark)({ width, height, edgeRoundness, cornerRadius }), ...props }));
};
exports.Spark = core_1.Interactive.withSchema({
    Component: SparkInner,
    componentName: '<Spark>',
    componentIdentity: 'dev.remotion.shapes.Spark',
    schema: sparkSchema,
    supportsEffects: true,
});
