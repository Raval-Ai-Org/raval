"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Triangle = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_triangle_1 = require("../utils/make-triangle");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const triangleSchema = (0, schema_1.makeShapeSchema)({
    length: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Length',
        min: 0,
    }),
    direction: (0, schema_1.enumField)({
        defaultValue: 'right',
        description: 'Direction',
        variants: ['right', 'left', 'up', 'down'],
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element containing a triangle with same length on all sides.
 * @param {Number} length The length of one triangle side.
 * @param {string} direction The direction of the triangle
 * @param {null|Number} edgeRoundness Allows to modify the shape by rounding the edges using bezier curves. Default null.
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius. Cannot be used together with edgeRoundness.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/triangle)
 */
const TriangleInner = ({ length, direction, edgeRoundness, cornerRadius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Triangle>", documentationLink: "https://www.remotion.dev/docs/shapes/triangle", ...(0, make_triangle_1.makeTriangle)({ length, direction, edgeRoundness, cornerRadius }), ...props }));
};
exports.Triangle = core_1.Interactive.withSchema({
    Component: TriangleInner,
    componentName: '<Triangle>',
    componentIdentity: 'dev.remotion.shapes.Triangle',
    schema: triangleSchema,
    supportsEffects: true,
});
