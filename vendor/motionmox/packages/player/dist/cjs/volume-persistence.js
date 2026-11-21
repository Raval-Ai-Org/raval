"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPreferredVolume = exports.persistVolume = void 0;
const core_1 = require("@motionmox/core");
const DEFAULT_VOLUME_PERSISTENCE_KEY = 'remotion.volumePreference';
const persistVolume = (volume, logLevel, volumePersistenceKey) => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(volumePersistenceKey !== null && volumePersistenceKey !== void 0 ? volumePersistenceKey : DEFAULT_VOLUME_PERSISTENCE_KEY, String(volume));
    }
    catch (e) {
        // User can disallow localStorage access
        // https://github.com/remotion-dev/remotion/issues/3540
        core_1.Internals.Log.error({ logLevel, tag: null }, 'Could not persist volume', e);
    }
};
exports.persistVolume = persistVolume;
const getPreferredVolume = (volumePersistenceKey) => {
    if (typeof window === 'undefined') {
        return 1;
    }
    try {
        const val = window.localStorage.getItem(volumePersistenceKey !== null && volumePersistenceKey !== void 0 ? volumePersistenceKey : DEFAULT_VOLUME_PERSISTENCE_KEY);
        return val ? Number(val) : 1;
    }
    catch (_a) {
        // User can disallow localStorage access
        // https://github.com/remotion-dev/remotion/issues/3540
        return 1;
    }
};
exports.getPreferredVolume = getPreferredVolume;
