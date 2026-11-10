"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openInRemotionConvert = exports.getRemotionConvertUrl = void 0;
const core_1 = require("@motionmox/core");
const getRemotionConvertUrl = ({ relativePath, studioOrigin, }) => {
    const convertUrl = new URL('https://www.remotion.dev/convert');
    const assetUrl = new URL((0, core_1.staticFile)(relativePath), studioOrigin);
    convertUrl.searchParams.set('url', assetUrl.toString());
    return convertUrl.toString();
};
exports.getRemotionConvertUrl = getRemotionConvertUrl;
const openInRemotionConvert = ({ relativePath, }) => {
    window.open((0, exports.getRemotionConvertUrl)({
        relativePath,
        studioOrigin: window.location.origin,
    }), '_blank', 'noopener,noreferrer');
};
exports.openInRemotionConvert = openInRemotionConvert;
