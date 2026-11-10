"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Callout = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_callout_1 = require("../utils/make-callout");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const calloutSchema = (0, schema_1.makeShapeSchema)({
    width: (0, schema_1.numberField)({
        defaultValue: 500,
        description: 'Width',
        min: 1,
    }),
    height: (0, schema_1.numberField)({
        defaultValue: 200,
        description: 'Height',
        min: 1,
    }),
    pointerLength: (0, schema_1.numberField)({
        defaultValue: 40,
        description: 'Pointer Length',
        min: 1,
    }),
    pointerBaseWidth: (0, schema_1.numberField)({
        defaultValue: 60,
        description: 'Pointer Base Width',
        min: 1,
    }),
    pointerPosition: (0, schema_1.numberField)({
        defaultValue: 0.5,
        description: 'Pointer Position',
        min: 0,
        max: 1,
        step: 0.01,
    }),
    pointerDirection: (0, schema_1.enumField)({
        defaultValue: 'down',
        description: 'Pointer Direction',
        variants: ['up', 'down', 'left', 'right'],
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
/**
 * @description Renders an SVG element containing a callout shape.
 * @param {Number} width The width of the callout body. Default 500.
 * @param {Number} height The height of the callout body. Default 200.
 * @param {Number} pointerLength The length of the pointer. Default 40.
 * @param {Number} pointerBaseWidth The width of the pointer where it meets the body. Default 60.
 * @param {Number} pointerPosition Position of the pointer along its side, from 0 to 1. Default 0.5.
 * @param {string} pointerDirection The direction the pointer points. Default 'down'.
 * @param {null|Number} edgeRoundness Allows to modify the shape by rounding the edges using bezier curves. Default null.
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius. Cannot be used together with edgeRoundness.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/callout)
 */
const CalloutInner = ({ width, height, pointerLength, pointerBaseWidth, pointerPosition, pointerDirection, edgeRoundness, cornerRadius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Callout>", documentationLink: "https://www.remotion.dev/docs/shapes/callout", ...(0, make_callout_1.makeCallout)({
            width,
            height,
            pointerLength,
            pointerBaseWidth,
            pointerPosition,
            pointerDirection,
            edgeRoundness,
            cornerRadius,
        }), ...props }));
};
exports.Callout = core_1.Interactive.withSchema({
    Component: CalloutInner,
    componentName: '<Callout>',
    componentIdentity: 'dev.remotion.shapes.Callout',
    schema: calloutSchema,
    supportsEffects: true,
});
