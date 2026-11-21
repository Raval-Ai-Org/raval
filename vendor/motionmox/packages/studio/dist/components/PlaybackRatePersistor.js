"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaybackRatePersistor = void 0;
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const playbackrate_1 = require("../state/playbackrate");
const PlaybackRatePersistor = () => {
    const { setPlaybackRate, playbackRate } = core_1.Internals.usePlaybackRate();
    (0, react_1.useEffect)(() => {
        setPlaybackRate((0, playbackrate_1.loadPlaybackRate)());
    }, [setPlaybackRate]);
    (0, react_1.useEffect)(() => {
        (0, playbackrate_1.persistPlaybackRate)(playbackRate);
    }, [playbackRate]);
    return null;
};
exports.PlaybackRatePersistor = PlaybackRatePersistor;
