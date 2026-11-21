"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goToComposition = void 0;
const core_1 = require("@motionmox/core");
/**
 * Selects a composition in the MotionMox Studio.
 * @param compositionId - The ID of the composition to select.
 * @see [Documentation](/docs/studio/go-to-composition)
 */
const goToComposition = (compositionId) => {
    var _a;
    (_a = core_1.Internals.compositionSelectorRef.current) === null || _a === void 0 ? void 0 : _a.selectComposition(compositionId);
};
exports.goToComposition = goToComposition;
