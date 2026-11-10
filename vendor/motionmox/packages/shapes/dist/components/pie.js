"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pie = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_pie_1 = require("../utils/make-pie");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const pieSchema = (0, schema_1.makeShapeSchema)({
    radius: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Radius',
        min: 0,
    }),
    progress: (0, schema_1.numberField)({
        defaultValue: 0.5,
        description: 'Progress',
        max: 1,
        min: 0,
        step: 0.01,
    }),
    closePath: (0, schema_1.booleanField)({
        defaultValue: true,
        description: 'Close Path',
    }),
    counterClockwise: (0, schema_1.booleanField)({
        defaultValue: false,
        description: 'Counter Clockwise',
    }),
    rotation: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Rotation',
        step: 0.01,
    }),
});
/**
 * @description Renders an SVG element drawing a pie piece.
 * @param {Number} radius The radius of the circle..
 * @param {Number} progress The percentage of the circle that is filled. 0 means fully empty, 1 means fully filled.
 * @param {Boolean} closePath If set to false, no path to the middle of the circle will be drawn, leading to an open arc. Default true.
 * @param {Boolean} counterClockwise If set, the circle gets filled counterclockwise instead of clockwise. Default false.
 * @param {Number} rotation Add rotation to the path. 0 means no rotation, Math.PI * 2 means 1 full clockwise rotation
 * @see [Documentation](https://www.remotion.dev/docs/shapes/pie)
 */
const PieInner = ({ radius, progress, closePath, counterClockwise, rotation, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Pie>", documentationLink: "https://www.remotion.dev/docs/shapes/pie", ...(0, make_pie_1.makePie)({ radius, progress, closePath, counterClockwise, rotation }), ...props }));
};
exports.Pie = core_1.Interactive.withSchema({
    Component: PieInner,
    componentName: '<Pie>',
    componentIdentity: 'dev.remotion.shapes.Pie',
    schema: pieSchema,
    supportsEffects: true,
});
