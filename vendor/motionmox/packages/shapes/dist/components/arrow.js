"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Arrow = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_arrow_1 = require("../utils/make-arrow");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const arrowSchema = (0, schema_1.makeShapeSchema)({
    length: (0, schema_1.numberField)({
        defaultValue: 300,
        description: 'Length',
        min: 0,
    }),
    headWidth: (0, schema_1.numberField)({
        defaultValue: 185,
        description: 'Head Width',
        min: 0,
    }),
    headLength: (0, schema_1.numberField)({
        defaultValue: 120,
        description: 'Head Length',
        min: 0,
    }),
    shaftWidth: (0, schema_1.numberField)({
        defaultValue: 80,
        description: 'Shaft Width',
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
 * @description Renders an SVG element containing an arrow shape.
 * @param {Number} length The total length of the arrow along its direction axis. Default 300.
 * @param {Number} headWidth The width of the arrowhead at its widest point. Default 185.
 * @param {Number} headLength The length of the arrowhead portion. Default 120.
 * @param {Number} shaftWidth The width of the arrow shaft. Default 80.
 * @param {string} direction The direction the arrow points. Default 'right'.
 * @param {Number} cornerRadius Rounds the corner using an arc. Similar to CSS's border-radius.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/arrow)
 */
const ArrowInner = ({ length, headWidth, headLength, shaftWidth, direction, cornerRadius, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Arrow>", documentationLink: "https://www.remotion.dev/docs/shapes/arrow", ...(0, make_arrow_1.makeArrow)({
            length,
            headWidth,
            headLength,
            shaftWidth,
            direction,
            cornerRadius,
        }), ...props }));
};
exports.Arrow = core_1.Interactive.withSchema({
    Component: ArrowInner,
    componentName: '<Arrow>',
    componentIdentity: 'dev.remotion.shapes.Arrow',
    schema: arrowSchema,
    supportsEffects: true,
});
