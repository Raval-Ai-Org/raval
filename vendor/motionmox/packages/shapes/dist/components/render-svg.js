"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderSvg = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const react_dom_1 = require("react-dom");
const core_1 = require("@motionmox/core");
const does_react_support_canary_1 = require("../utils/does-react-support-canary");
const HtmlInCanvasWithPrivateProps = core_1.HtmlInCanvas;
const RenderSvgWithTiming = ({ premountFor, postmountFor, styleWhilePremounted, styleWhilePostmounted, from, trimBefore, playbackRate, loop, freeze, hidden, showInTimeline, controls, durationInFrames, name, defaultName, documentationLink, memoizedEffectDefinitions, content, actualStyle, }) => {
    const { effectivePremountFor, effectivePostmountFor, freezeFrame, isPremountingOrPostmounting, premountingActive, postmountingActive, premountingStyle, } = core_1.Internals.usePremounting({
        from: from !== null && from !== void 0 ? from : 0,
        durationInFrames: core_1.Internals.resolveSequenceDuration({
            durationInFrames,
            playbackRate,
            loop,
        }),
        premountFor: premountFor !== null && premountFor !== void 0 ? premountFor : null,
        postmountFor: postmountFor !== null && postmountFor !== void 0 ? postmountFor : null,
        style: actualStyle,
        styleWhilePremounted: styleWhilePremounted !== null && styleWhilePremounted !== void 0 ? styleWhilePremounted : null,
        styleWhilePostmounted: styleWhilePostmounted !== null && styleWhilePostmounted !== void 0 ? styleWhilePostmounted : null,
        hideWhilePremounted: 'opacity',
    });
    return ((0, jsx_runtime_1.jsx)(core_1.Freeze, { frame: freezeFrame, active: isPremountingOrPostmounting, children: (0, jsx_runtime_1.jsx)(core_1.Sequence, { layout: "none", from: from, trimBefore: trimBefore, playbackRate: playbackRate, loop: loop, freeze: freeze, hidden: hidden, showInTimeline: showInTimeline, controls: controls, _remotionInternalEffects: memoizedEffectDefinitions, durationInFrames: durationInFrames, name: name !== null && name !== void 0 ? name : defaultName, _remotionInternalDocumentationLink: documentationLink, _remotionInternalPremountDisplay: effectivePremountFor || null, _remotionInternalPostmountDisplay: effectivePostmountFor || null, _remotionInternalIsPremounting: premountingActive, _remotionInternalIsPostmounting: postmountingActive, children: react_1.default.cloneElement(content, { style: premountingStyle !== null && premountingStyle !== void 0 ? premountingStyle : undefined }) }) }));
};
const RenderSvg = ({ defaultName, documentationLink, width, height, path, style, pathStyle, transformOrigin, debug, effects = [], effectsOutputSize, instructions, pixelDensity, durationInFrames, from, premountFor, postmountFor, styleWhilePremounted, styleWhilePostmounted, trimBefore, playbackRate, loop, freeze, hidden, name, showInTimeline, controls, ...props }) => {
    const actualStyle = (0, react_1.useMemo)(() => {
        return {
            overflow: 'visible',
            ...(style !== null && style !== void 0 ? style : {}),
        };
    }, [style]);
    const actualPathStyle = (0, react_1.useMemo)(() => {
        return {
            transformBox: 'fill-box',
            ...(pathStyle !== null && pathStyle !== void 0 ? pathStyle : {}),
        };
    }, [pathStyle]);
    const memoizedEffectDefinitions = core_1.Internals.useMemoizedEffectDefinitions(effects);
    const videoConfig = core_1.Internals.useUnsafeVideoConfig();
    const reactSupportsTransformOrigin = (0, does_react_support_canary_1.doesReactSupportTransformOriginProperty)(react_dom_1.version);
    const svg = ((0, jsx_runtime_1.jsxs)("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}`, xmlns: "http://www.w3.org/2000/svg", style: effects.length === 0 || !videoConfig
            ? actualStyle
            : { overflow: 'visible' }, children: [(0, jsx_runtime_1.jsx)("path", { ...(reactSupportsTransformOrigin
                    ? {
                        transformOrigin,
                    }
                    : {
                        'transform-origin': transformOrigin,
                    }), d: path, style: actualPathStyle, ...props }), debug
                ? instructions.map((i, index) => {
                    if (i.type === 'C') {
                        const prevInstruction = index === 0
                            ? instructions[instructions.length - 1]
                            : instructions[index - 1];
                        if (prevInstruction.type === 'V' ||
                            prevInstruction.type === 'H' ||
                            prevInstruction.type === 'a' ||
                            prevInstruction.type === 'Z' ||
                            prevInstruction.type === 't' ||
                            prevInstruction.type === 'q' ||
                            prevInstruction.type === 'l' ||
                            prevInstruction.type === 'c' ||
                            prevInstruction.type === 'm' ||
                            prevInstruction.type === 'h' ||
                            prevInstruction.type === 's' ||
                            prevInstruction.type === 'v') {
                            return null;
                        }
                        const prevX = prevInstruction.x;
                        const prevY = prevInstruction.y;
                        return ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [(0, jsx_runtime_1.jsx)("path", { d: `M ${prevX} ${prevY} ${i.cp1x} ${i.cp1y}`, strokeWidth: 2, stroke: "rgba(0, 0, 0, 0.4)" }), (0, jsx_runtime_1.jsx)("path", { d: `M ${i.x} ${i.y} ${i.cp2x} ${i.cp2y}`, strokeWidth: 2, stroke: "rgba(0, 0, 0, 0.4)" }), (0, jsx_runtime_1.jsx)("circle", { cx: i.cp1x, cy: i.cp1y, r: 3, fill: "white", strokeWidth: 2, stroke: "black" }), (0, jsx_runtime_1.jsx)("circle", { cx: i.cp2x, cy: i.cp2y, r: 3, strokeWidth: 2, fill: "white", stroke: "black" })] }, index));
                    }
                    return null;
                })
                : null] }));
    const content = effects.length === 0 ? (svg) : ((0, jsx_runtime_1.jsx)(HtmlInCanvasWithPrivateProps, { width: Math.ceil(width), height: Math.ceil(height), effects: effects, effectsOutputSize: effectsOutputSize, pixelDensity: pixelDensity, showInTimeline: false, style: actualStyle, controls: controls, children: svg }));
    if (!videoConfig) {
        return svg;
    }
    return ((0, jsx_runtime_1.jsx)(RenderSvgWithTiming, { premountFor: premountFor, postmountFor: postmountFor, styleWhilePremounted: styleWhilePremounted, styleWhilePostmounted: styleWhilePostmounted, from: from, trimBefore: trimBefore, playbackRate: playbackRate, loop: loop, freeze: freeze, hidden: hidden, showInTimeline: showInTimeline, controls: controls, durationInFrames: durationInFrames, name: name, defaultName: defaultName, documentationLink: documentationLink, memoizedEffectDefinitions: memoizedEffectDefinitions, content: content, actualStyle: actualStyle }));
};
exports.RenderSvg = RenderSvg;
