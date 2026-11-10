"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStill = exports.createComposition = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const core_1 = require("@motionmox/core");
const createComposition = ({ ...other }) => () => {
    // @ts-expect-error
    return (0, jsx_runtime_1.jsx)(core_1.Composition, { ...other });
};
exports.createComposition = createComposition;
const createStill = ({ ...other }) => () => {
    // @ts-expect-error
    return (0, jsx_runtime_1.jsx)(core_1.Still, { ...other });
};
exports.createStill = createStill;
