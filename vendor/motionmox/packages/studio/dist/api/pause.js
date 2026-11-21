"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pause = void 0;
const core_1 = require("@motionmox/core");
/*
 * @description Pause the current composition.
 * @see [Documentation](https://www.remotion.dev/docs/studio/pause)
 */
const pause = () => {
    var _a;
    (_a = core_1.Internals.timeValueRef.current) === null || _a === void 0 ? void 0 : _a.pause();
};
exports.pause = pause;
