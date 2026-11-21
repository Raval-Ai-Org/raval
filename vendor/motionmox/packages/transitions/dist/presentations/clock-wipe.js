"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clockWipe = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const paths_1 = require("@motionmox/paths");
const shapes_1 = require("@motionmox/shapes");
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const ClockWipePresentation = ({ children, presentationDirection, presentationProgress, passedProps }) => {
    const finishedRadius = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
    const { path } = (0, shapes_1.makePie)({
        radius: finishedRadius,
        progress: presentationProgress,
    });
    const translatedPath = (0, paths_1.translatePath)(path, -(finishedRadius * 2 - passedProps.width) / 2, -(finishedRadius * 2 - passedProps.height) / 2);
    const style = (0, react_1.useMemo)(() => {
        return {
            width: '100%',
            height: '100%',
            clipPath: presentationDirection === 'exiting'
                ? undefined
                : `path("${translatedPath}")`,
            ...(presentationDirection === 'entering'
                ? passedProps.innerEnterStyle
                : passedProps.innerExitStyle),
        };
    }, [
        translatedPath,
        passedProps.innerEnterStyle,
        passedProps.innerExitStyle,
        presentationDirection,
    ]);
    const outerStyle = (0, react_1.useMemo)(() => {
        return presentationDirection === 'entering'
            ? passedProps.outerEnterStyle
            : passedProps.outerExitStyle;
    }, [
        passedProps.outerEnterStyle,
        passedProps.outerExitStyle,
        presentationDirection,
    ]);
    return ((0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: outerStyle, children: (0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: style, children: children }) }));
};
/*
 * @description Creates a clock wipe transition that uses a circular wipe to reveal the underlying scene as the current scene exits.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/presentations/clock-wipe)
 */
const clockWipe = (props) => {
    return { component: ClockWipePresentation, props: props !== null && props !== void 0 ? props : {} };
};
exports.clockWipe = clockWipe;
