"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useBufferStateEmitter = void 0;
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const useBufferStateEmitter = (emitter) => {
    const { subscribeBuffering } = (0, react_1.useContext)(core_1.Internals.SetTimelineContext);
    (0, react_1.useLayoutEffect)(() => {
        return subscribeBuffering((state) => {
            if (state.buffering) {
                emitter.dispatchWaiting({});
            }
            else {
                emitter.dispatchResume({});
            }
        });
    }, [emitter, subscribeBuffering]);
};
exports.useBufferStateEmitter = useBufferStateEmitter;
