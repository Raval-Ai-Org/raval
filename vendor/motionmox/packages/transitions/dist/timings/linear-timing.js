"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.linearTiming = void 0;
const core_1 = require("@motionmox/core");
/*
 * @description A timing function for `<TransitionSeries>` based on `interpolate()`.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/timings/lineartiming)
 */
const linearTiming = (options) => {
    return {
        getDurationInFrames: () => {
            return options.durationInFrames;
        },
        getProgress: ({ frame }) => {
            return (0, core_1.interpolate)(frame, [0, options.durationInFrames], [0, 1], {
                easing: options.easing,
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
            });
        },
    };
};
exports.linearTiming = linearTiming;
