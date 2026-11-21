"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushCut = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const clamp = {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
};
const validateFiniteNumber = (name, value) => {
    if (!Number.isFinite(value)) {
        throw new TypeError(`${name} passed to pushCut() must be finite, received ${value}`);
    }
};
const validateProps = (props) => {
    var _a, _b, _c, _d, _e, _f;
    const cutProgress = (_a = props.cutProgress) !== null && _a !== void 0 ? _a : 5 / 11;
    const outgoingScale = (_b = props.outgoingScale) !== null && _b !== void 0 ? _b : 1.04;
    const incomingStartScale = (_c = props.incomingStartScale) !== null && _c !== void 0 ? _c : 1.04;
    const incomingEndScale = (_d = props.incomingEndScale) !== null && _d !== void 0 ? _d : 1.07;
    const flashOpacity = (_e = props.flashOpacity) !== null && _e !== void 0 ? _e : 0.2;
    const flashFrames = (_f = props.flashFrames) !== null && _f !== void 0 ? _f : 2;
    validateFiniteNumber('cutProgress', cutProgress);
    if (cutProgress <= 0 || cutProgress >= 1) {
        throw new TypeError(`cutProgress passed to pushCut() must be greater than 0 and less than 1, received ${cutProgress}`);
    }
    for (const [name, value] of [
        ['outgoingScale', outgoingScale],
        ['incomingStartScale', incomingStartScale],
        ['incomingEndScale', incomingEndScale],
    ]) {
        validateFiniteNumber(name, value);
        if (value <= 0) {
            throw new TypeError(`${name} passed to pushCut() must be greater than 0, received ${value}`);
        }
    }
    validateFiniteNumber('flashOpacity', flashOpacity);
    if (flashOpacity < 0 || flashOpacity > 1) {
        throw new TypeError(`flashOpacity passed to pushCut() must be between 0 and 1, received ${flashOpacity}`);
    }
    validateFiniteNumber('flashFrames', flashFrames);
    if (flashFrames < 0) {
        throw new TypeError(`flashFrames passed to pushCut() must be greater than or equal to 0, received ${flashFrames}`);
    }
};
const PushCutPresentation = ({ children, presentationDirection, presentationDurationInFrames, presentationProgress, passedProps, }) => {
    const { cutProgress = 5 / 11, outgoingScale = 1.04, incomingStartScale = 1.04, incomingEndScale = 1.07, transformOrigin = '50% 50%', flashColor = '#f5f2ed', flashOpacity: peakFlashOpacity = 0.2, flashFrames = 2, outerEnterStyle, outerExitStyle, innerEnterStyle, innerExitStyle, } = passedProps;
    const isEntering = presentationDirection === 'entering';
    const outgoingProgress = (0, core_1.interpolate)(presentationProgress, [0, cutProgress], [0, 1], {
        ...clamp,
        easing: core_1.Easing.in(core_1.Easing.quad),
    });
    const incomingProgress = (0, core_1.interpolate)(presentationProgress, [cutProgress, 1], [0, 1], {
        ...clamp,
        easing: core_1.Easing.out(core_1.Easing.quad),
    });
    const scale = isEntering
        ? (0, core_1.interpolate)(incomingProgress, [0, 1], [incomingStartScale, incomingEndScale])
        : (0, core_1.interpolate)(outgoingProgress, [0, 1], [1, outgoingScale]);
    const oneFrame = 1 / Math.max(1, presentationDurationInFrames);
    const flashTail = flashFrames / Math.max(1, presentationDurationInFrames);
    const flashOpacity = isEntering
        ? (0, core_1.interpolate)(presentationProgress, [cutProgress, cutProgress + flashTail], [peakFlashOpacity, 0], clamp)
        : (0, core_1.interpolate)(presentationProgress, [cutProgress - oneFrame, cutProgress], [0, peakFlashOpacity], clamp);
    const outerStyle = (0, react_1.useMemo)(() => {
        return {
            opacity: isEntering && presentationProgress < cutProgress ? 0 : 1,
            overflow: 'hidden',
            ...(isEntering ? outerEnterStyle : outerExitStyle),
        };
    }, [
        cutProgress,
        isEntering,
        outerEnterStyle,
        outerExitStyle,
        presentationProgress,
    ]);
    const innerStyle = (0, react_1.useMemo)(() => {
        return {
            transform: `scale(${scale})`,
            transformOrigin,
            willChange: 'transform',
            ...(isEntering ? innerEnterStyle : innerExitStyle),
        };
    }, [innerEnterStyle, innerExitStyle, isEntering, scale, transformOrigin]);
    return ((0, jsx_runtime_1.jsxs)(core_1.AbsoluteFill, { showInTimeline: false, style: outerStyle, children: [(0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: innerStyle, children: children }), flashOpacity > 0 ? ((0, jsx_runtime_1.jsx)(core_1.AbsoluteFill, { showInTimeline: false, style: {
                    backgroundColor: flashColor,
                    opacity: flashOpacity,
                    pointerEvents: 'none',
                } })) : null] }));
};
/*
 * Created by Tom Vaillant: https://github.com/tomvaillant
 * @description A hard editorial cut with a short punch-in on both scenes and a brief flash at the edit point.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/presentations/push-cut)
 */
const pushCut = (props) => {
    const passedProps = props !== null && props !== void 0 ? props : {};
    validateProps(passedProps);
    return {
        component: PushCutPresentation,
        props: passedProps,
    };
};
exports.pushCut = pushCut;
