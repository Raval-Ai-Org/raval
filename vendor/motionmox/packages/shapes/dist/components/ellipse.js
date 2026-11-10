"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ellipse = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_ellipse_1 = require("../utils/make-ellipse");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const ellipseSchema = (0, schema_1.makeShapeSchema)({
    rx: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'X Radius',
        min: 0,
    }),
    ry: (0, schema_1.numberField)({
        defaultValue: 50,
        description: 'Y Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element drawing an ellipse.
 * @param {Number} rx The radius of the ellipse on the X axis.
 * @param {Number} ry The radius of the ellipse on the Y axis.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/ellipse)
 */
const EllipseInner = ({ rx, ry, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Ellipse>", documentationLink: "https://www.remotion.dev/docs/shapes/ellipse", ...(0, make_ellipse_1.makeEllipse)({ rx, ry }), ...props }));
};
exports.Ellipse = core_1.Interactive.withSchema({
    Component: EllipseInner,
    componentName: '<Ellipse>',
    componentIdentity: 'dev.remotion.shapes.Ellipse',
    schema: ellipseSchema,
    supportsEffects: true,
});
