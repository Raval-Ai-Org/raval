"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iris = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const paths_1 = require("@motionmox/paths");
const shapes_1 = require("@motionmox/shapes");
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const IrisPresentation = ({ children, presentationDirection, presentationProgress, passedProps }) => {
    const maxRadius = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
    const minRadius = 0;
    const currentRadius = presentationDirection === 'entering'
        ? minRadius + (maxRadius - minRadius) * presentationProgress
        : maxRadius - (maxRadius - minRadius) * presentationProgress;
    const { path } = (0, shapes_1.makeCircle)({
        radius: currentRadius,
    });
    const translatedPath = (0, paths_1.translatePath)(path, passedProps.width / 2 - currentRadius, passedProps.height / 2 - currentRadius);
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
 * @description Creates an iris transition that uses a circular mask starting from the center to reveal the underlying scene.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/presentations/iris)
 */
const iris = (props) => {
    return { component: IrisPresentation, props: props !== null && props !== void 0 ? props : {} };
};
exports.iris = iris;
