"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useIsVideoComposition = exports.useIsStill = void 0;
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const is_composition_still_1 = require("./is-composition-still");
const useIsStill = () => {
    const resolved = core_1.Internals.useResolvedVideoConfig(null);
    if (!resolved || resolved.type !== 'success') {
        return false;
    }
    return (0, is_composition_still_1.isCompositionStill)(resolved.result);
};
exports.useIsStill = useIsStill;
const useIsVideoComposition = () => {
    const isStill = (0, exports.useIsStill)();
    const { canvasContent, currentAssetMetadata } = (0, react_1.useContext)(core_1.Internals.CompositionManager);
    if (canvasContent === null) {
        return false;
    }
    if (isStill) {
        return false;
    }
    return (canvasContent.type === 'composition' ||
        (canvasContent.type === 'asset' &&
            (currentAssetMetadata === null || currentAssetMetadata === void 0 ? void 0 : currentAssetMetadata.asset) === canvasContent.asset));
};
exports.useIsVideoComposition = useIsVideoComposition;
