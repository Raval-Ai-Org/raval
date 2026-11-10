"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeShapeSchema = exports.enumField = exports.colorField = exports.booleanField = exports.numberField = void 0;
const core_1 = require("@motionmox/core");
const numberField = ({ defaultValue, description, hiddenFromList = false, integer, max, min, step = 1, }) => {
    return {
        type: 'number',
        default: defaultValue,
        description,
        hiddenFromList,
        integer,
        max,
        min,
        step,
    };
};
exports.numberField = numberField;
const booleanField = ({ defaultValue, description, }) => {
    return {
        type: 'boolean',
        default: defaultValue,
        description,
    };
};
exports.booleanField = booleanField;
const colorField = ({ defaultValue, description, }) => {
    return {
        type: 'color',
        default: defaultValue,
        description,
    };
};
exports.colorField = colorField;
const enumField = ({ defaultValue, description, variants, }) => {
    return {
        type: 'enum',
        default: defaultValue,
        description,
        variants: Object.fromEntries(variants.map((variant) => [variant, {}])),
    };
};
exports.enumField = enumField;
const makeShapeSchema = (shapeFields) => {
    return {
        ...core_1.Internals.baseSchema,
        ...shapeFields,
        fill: (0, exports.colorField)({
            defaultValue: '#0b84ff',
            description: 'Fill',
        }),
        ...core_1.Internals.transformSchema,
        ...core_1.Interactive.backgroundSchema,
        ...core_1.Interactive.borderSchema,
        ...core_1.Interactive.borderRadiusSchema,
    };
};
exports.makeShapeSchema = makeShapeSchema;
