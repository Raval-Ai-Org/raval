"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStaticFiles = void 0;
const v5_flag_1 = require("./v5-flag");
let warnedServer = false;
let warnedPlayer = false;
const warnServerOnce = () => {
    if (warnedServer) {
        return;
    }
    warnedServer = true;
    // eslint-disable-next-line no-console
    console.warn('Called getStaticFiles() on the server. The API is only available in the browser. An empty array was returned.');
};
const warnPlayerOnce = () => {
    if (warnedPlayer) {
        return;
    }
    warnedPlayer = true;
    // eslint-disable-next-line no-console
    console.warn('Called getStaticFiles() while using the MotionMox Player. The API is only available while using the MotionMox Studio. An empty array was returned.');
};
/*
 * @description Gets an array containing all files in the `public/` folder. You can reference them by using `staticFile()`.
 * @see [Documentation](https://remotion.dev/docs/getstaticfiles)
 */
const getStaticFiles = () => {
    if (v5_flag_1.ENABLE_V5_BREAKING_CHANGES) {
        throw new Error('getStaticFiles() has moved into the `@motionmox/studio` package. Update your imports.');
    }
    if (typeof document === 'undefined') {
        warnServerOnce();
        return [];
    }
    if (window.remotion_isPlayer) {
        warnPlayerOnce();
        return [];
    }
    return window.remotion_staticFiles;
};
exports.getStaticFiles = getStaticFiles;
