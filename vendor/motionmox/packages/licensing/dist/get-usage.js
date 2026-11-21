"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsage = void 0;
const register_usage_event_1 = require("./register-usage-event");
const getUsage = async ({ since, ...apiOrLicenseKey }) => {
    var _a;
    // MOTIONMOX-PATCH usage-off
    if (typeof process === 'undefined' ||
        ((_a = process.env) === null || _a === void 0 ? void 0 : _a.MOTIONMOX_USAGE_EVENTS) !== 'true') {
        throw new Error('MotionMox: usage reads are off.');
    }
    const apiKey = 'apiKey' in apiOrLicenseKey ? apiOrLicenseKey.apiKey : null;
    const licenseKey = 'licenseKey' in apiOrLicenseKey ? apiOrLicenseKey.licenseKey : null;
    const res = await fetch(`${register_usage_event_1.HOST}/api/track/get-usage`, {
        method: 'POST',
        body: JSON.stringify({
            apiKey: licenseKey !== null && licenseKey !== void 0 ? licenseKey : apiKey,
            since: since !== null && since !== void 0 ? since : null,
        }),
        headers: {
            'Content-Type': 'application/json',
        },
    });
    const json = (await res.json());
    if (json.success) {
        return {
            cloudRenders: json.cloudRenders,
            webRenders: json.webcodecConversions,
            webcodecConversions: json.webcodecConversions,
        };
    }
    if (!res.ok) {
        throw new Error(json.error);
    }
    throw new Error(`Unexpected response from server: ${JSON.stringify(json)}`);
};
exports.getUsage = getUsage;
