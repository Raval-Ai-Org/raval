"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rect = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_rect_1 = require("../utils/make-rect");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const rectSchema = (0, schema_1.makeShapeSchema)({
    width: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Width',
        min: 0,
    }),
    height: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Height',
        min: 0,
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element containing a rectangle.
 * @param {Number} width The width of the Rectangle
 * @param {Number} height The height of the Rectangle
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius. Cannot be used together with edgeRoundness.
 * @param {null|Number} edgeRoundness Allows to modify the shape by rounding the edges using bezier curves. Default null.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/rect)
 */
const RectInner = ({ width, edgeRoundness, height, cornerRadius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Rect>", documentationLink: "https://www.remotion.dev/docs/shapes/rect", ...(0, make_rect_1.makeRect)({ height, width, edgeRoundness, cornerRadius }), ...props }));
};
exports.Rect = core_1.Interactive.withSchema({
    Component: RectInner,
    componentName: '<Rect>',
    componentIdentity: 'dev.remotion.shapes.Rect',
    schema: rectSchema,
    supportsEffects: true,
});
