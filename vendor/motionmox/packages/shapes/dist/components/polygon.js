"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Polygon = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const make_polygon_1 = require("../utils/make-polygon");
const render_svg_1 = require("./render-svg");
const schema_1 = require("./schema");
const polygonSchema = (0, schema_1.makeShapeSchema)({
    points: (0, schema_1.numberField)({
        defaultValue: 5,
        description: 'Points',
        min: 3,
        step: 1,
        integer: true,
    }),
    radius: (0, schema_1.numberField)({
        defaultValue: 100,
        description: 'Radius',
        min: 0,
    }),
    cornerRadius: (0, schema_1.numberField)({
        defaultValue: 0,
        description: 'Corner Radius',
        min: 0,
    }),
});
const PolygonInner = ({ points, radius, cornerRadius, edgeRoundness, ...props }) => {
    return ((0, jsx_runtime_1.jsx)(render_svg_1.RenderSvg, { defaultName: "<Polygon>", documentationLink: "https://www.remotion.dev/docs/shapes/polygon", ...(0, make_polygon_1.makePolygon)({
            points,
            cornerRadius,
            edgeRoundness,
            radius,
        }), ...props }));
};
exports.Polygon = core_1.Interactive.withSchema({
    Component: PolygonInner,
    componentName: '<Polygon>',
    componentIdentity: 'dev.remotion.shapes.Polygon',
    schema: polygonSchema,
    supportsEffects: true,
});
