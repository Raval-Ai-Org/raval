"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reevaluateComposition = void 0;
const core_1 = require("@motionmox/core");
const reevaluateComposition = () => {
    var _a;
    (_a = core_1.Internals.resolveCompositionsRef.current) === null || _a === void 0 ? void 0 : _a.reloadCurrentlySelectedComposition();
};
exports.reevaluateComposition = reevaluateComposition;
