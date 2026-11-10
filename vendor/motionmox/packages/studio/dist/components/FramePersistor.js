"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FramePersistor = void 0;
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const FramePersistor = () => {
    const playing = core_1.Internals.usePlaying();
    const config = (0, core_1.useVideoConfig)();
    const frame = core_1.Internals.Timeline.useTimelinePosition();
    const setFrameWithoutSeek = core_1.Internals.useTimelineSetFrameWithoutSeek();
    (0, react_1.useEffect)(() => {
        if (!playing) {
            setFrameWithoutSeek((f) => {
                const newObj = f[config.id] === frame ? f : { ...f, [config.id]: frame };
                core_1.Internals.persistCurrentFrame(newObj);
                return newObj;
            });
        }
    }, [config.id, frame, playing, setFrameWithoutSeek]);
    return null;
};
exports.FramePersistor = FramePersistor;
