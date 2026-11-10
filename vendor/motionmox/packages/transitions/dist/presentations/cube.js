"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cube = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
// SPDX-License-Identifier: MIT
// See ../../LICENSE.cube.md for attribution and license terms.
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const Cube = ({ children, presentationDirection, presentationProgress, passedProps: { perspective = 1000, ...passedProps }, }) => {
    const style = (0, react_1.useMemo)(() => {
        const startRotationEntering = passedProps.direction === 'from-right' ||
            passedProps.direction === 'from-top'
            ? 90
            : -90;
        const endRotationEntering = passedProps.direction === 'from-right' ||
            passedProps.direction === 'from-top'
            ? -90
            : 90;
        const startPositionEntering = passedProps.direction === 'from-right' ||
            passedProps.direction === 'from-bottom'
            ? 100
            : -100;
        const startPositionExiting = passedProps.direction === 'from-right' ||
            passedProps.direction === 'from-bottom'
            ? -100
            : 100;
        const transformOriginEntering = passedProps.direction === 'from-left'
            ? 'right'
            : passedProps.direction === 'from-bottom'
                ? 'top'
                : passedProps.direction === 'from-top'
                    ? 'bottom'
                    : 'left';
        const transformOriginExiting = passedProps.direction === 'from-left'
            ? 'left'
            : passedProps.direction === 'from-bottom'
                ? 'bottom'
                : passedProps.direction === 'from-top'
                    ? 'top'
                    : 'right';
        const rotation = presentationDirection === 'entering'
            ? (0, core_1.interpolate)(presentationProgress, [0, 1], [startRotationEntering, 0])
            : (0, core_1.interpolate)(presentationProgress, [0, 1], [0, endRotationEntering]);
        const transformOrigin = presentationDirection === 'entering'
            ? transformOriginEntering
            : transformOriginExiting;
        const translate = `${presentationDirection === 'entering'
            ? (0, core_1.interpolate)(presentationProgress, [0, 1], [startPositionEntering, 0])
            : (0, core_1.interpolate)(presentationProgress, [0, 1], [0, startPositionExiting])}%`;
        const translateProperty = passedProps.direction === 'from-top' ||
            passedProps.direction === 'from-bottom'
            ? 'translateY'
            : 'translateX';
        const rotateProperty = passedProps.direction === 'from-top' ||
            passedProps.direction === 'from-bottom'
            ? 'rotateX'
            : 'rotateY';
        return {
            width: '100%',
            height: '100%',
            transformOrigin,
            transform: `${translateProperty}(${translate}) ${rotateProperty}(${rotation}deg)`,
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
        };
    }, [passedProps.direction, presentationDirection, presentationProgress]);
    return ((0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: {
            perspective,
            transformStyle: 'preserve-3d',
        }, children: (0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: style, children: children }) }));
};
/**
 * @description Rotates the entering and exiting scenes as faces of a 3D cube.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/presentations/cube)
 */
const cube = (props) => {
    return { component: Cube, props };
};
exports.cube = cube;
