"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Heart = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_heart_1 = require("../utils/make-heart");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const heartSchema = (0, schema_1.makeShapeSchema)({
    height: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Height',
        min: 0,
    }),
    aspectRatio: (0, schema_1.numberField)({
        defaultValue: 1.1,
        description: 'Aspect Ratio',
        min: 0,
        step: 0.01,
    }),
    bottomRoundnessAdjustment: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Bottom Roundness Adjustment',
        step: 0.01,
    }),
    depthAdjustment: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Depth Adjustment',
        step: 0.01,
    }),
});
/**
 * @description Renders an SVG element containing a heart.
 * @param {Number} size The size of the heart.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/heart)
 */
const HeartInner = ({ aspectRatio, height, bottomRoundnessAdjustment = 0, depthAdjustment = 0, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Heart>", documentationLink: "https://www.remotion.dev/docs/shapes/heart", ...(0, make_heart_1.makeHeart)({
            aspectRatio,
            height,
            bottomRoundnessAdjustment,
            depthAdjustment,
        }), ...props }));
};
exports.Heart = core_1.Interactive.withSchema({
    Component: HeartInner,
    componentName: '<Heart>',
    componentIdentity: 'dev.remotion.shapes.Heart',
    schema: heartSchema,
    supportsEffects: true,
});
