"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Circle = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_circle_1 = require("../utils/make-circle");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const circleSchema = (0, schema_1.makeShapeSchema)({
    radius: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element drawing a circle.
 * @param {Number} radius The radius of the circle.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/circle)
 */
const CircleInner = ({ radius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Circle>", documentationLink: "https://www.remotion.dev/docs/shapes/circle", ...(0, make_circle_1.makeCircle)({ radius }), ...props }));
};
exports.Circle = core_1.Interactive.withSchema({
    Component: CircleInner,
    componentName: '<Circle>',
    componentIdentity: 'dev.remotion.shapes.Circle',
    schema: circleSchema,
    supportsEffects: true,
});
