"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Star = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_star_1 = require("../utils/make-star");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const starSchema = (0, schema_1.makeShapeSchema)({
    points: (0, schema_1.numberField)({
        defaultValue: 5,
        description: 'Points',
        min: 3,
        step: 1,
        integer: true,
    }),
    innerRadius: (0, schema_1.numberField)({
        defaultValue: 50,
        description: 'Inner Radius',
        min: 0,
    }),
    outerRadius: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Outer Radius',
        min: 0,
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element containing a star.
 * @param {Number} innerRadius The inner radius of the star.
 * @param {Number} outerRadius The outer radius of the star.
 * @param {Number} points The amount of points of the star.
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius. Cannot be used together with edgeRoundness.
 * @param {null|Number} edgeRoundness Allows to modify the shape by rounding the edges using bezier curves. Default null.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/star)
 */
const StarInner = ({ innerRadius, outerRadius, points, cornerRadius, edgeRoundness, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Star>", documentationLink: "https://www.remotion.dev/docs/shapes/star", ...(0, make_star_1.makeStar)({
            innerRadius,
            outerRadius,
            points,
            cornerRadius,
            edgeRoundness,
        }), ...props }));
};
exports.Star = core_1.Interactive.withSchema({
    Component: StarInner,
    componentName: '<Star>',
    componentIdentity: 'dev.remotion.shapes.Star',
    schema: starSchema,
    supportsEffects: true,
});
