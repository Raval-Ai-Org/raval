"use strict";
/**
 * @description Restarts the MotionMox Studio process.
 * @see [Documentation](https://www.remotion.dev/docs/studio/restart-studio)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restartStudio = void 0;
const core_1 = require("@motionmox/core");
const call_api_1 = require("../components/call-api");
const browser_studio_operations_1 = require("../helpers/browser-studio-operations");
const restartStudio = () => {
    if (!(0, core_1.getRemotionEnvironment)().isStudio) {
        throw new Error('restartStudio() is only available in the Studio');
    }
    if ((0, browser_studio_operations_1.getBrowserStudioOperations)() !== null) {
        throw new Error('restartStudio() is not supported in Browser Studio');
    }
    if (window.remotion_isReadOnlyStudio) {
        throw new Error('restartStudio() is not available in read-only Studio');
    }
    return (0, call_api_1.callApi)('/api/restart-studio', {});
};
exports.restartStudio = restartStudio;
