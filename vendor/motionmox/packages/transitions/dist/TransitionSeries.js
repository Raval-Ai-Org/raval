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
exports.TransitionSeries = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const react_dom_1 = require("react-dom");
const core_1 = require("@motionmox/core");
const no_react_1 = require("@motionmox/core/no-react");
const context_js_1 = require("./context.js");
const find_dangling_connectors_js_1 = require("./find-dangling-connectors.js");
const flatten_children_js_1 = require("./flatten-children.js");
const slide_js_1 = require("./presentations/slide.js");
const validate_js_1 = require("./validate.js");
const { SequenceWithoutSchema, TrackWithoutSchema } = core_1.Internals;
const TransitionSeriesTransitionInner = ({ _remotionInternalRender = null, ...props }) => {
    if (_remotionInternalRender) {
        return _remotionInternalRender(props);
    }
    return null;
};
const transitionSeriesTransitionSchema = {};
const TransitionSeriesTransition = core_1.Interactive.withSchema({
    Component: TransitionSeriesTransitionInner,
    componentName: '<TransitionSeries.Transition>',
    componentIdentity: 'dev.remotion.transitions.TransitionSeries.Transition',
    schema: transitionSeriesTransitionSchema,
    supportsEffects: false,
});
const SeriesOverlayInner = ({ _remotionInternalRender = null, ...props }) => {
    if (_remotionInternalRender) {
        return _remotionInternalRender(props);
    }
    return null;
};
const transitionSeriesOverlaySchema = {
    hidden: core_1.Internals.sequenceSchema.hidden,
};
const SeriesOverlay = core_1.Interactive.withSchema({
    Component: SeriesOverlayInner,
    componentName: '<TransitionSeries.Overlay>',
    componentIdentity: 'dev.remotion.transitions.TransitionSeries.Overlay',
    schema: transitionSeriesOverlaySchema,
    supportsEffects: false,
});
const transitionSeriesSequenceSchema = {
    durationInFrames: core_1.Internals.durationInFramesField,
    name: core_1.Internals.sequenceSchema.name,
    hidden: core_1.Internals.sequenceSchema.hidden,
    showInTimeline: core_1.Internals.sequenceSchema.showInTimeline,
    freeze: core_1.Internals.freezeField,
    trimBefore: core_1.Internals.sequenceSchema.trimBefore,
    playbackRate: core_1.Internals.sequenceSchema.playbackRate,
    layout: core_1.Internals.sequenceSchema.layout,
};
const SeriesSequenceInner = ({ offset = 0, className = '', _remotionInternalRender = null, ...props }) => {
    if (_remotionInternalRender) {
        return _remotionInternalRender({
            ...props,
            offset,
            className: className || undefined,
        });
    }
    // eslint-disable-next-line react/jsx-no-useless-fragment
    return (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: props.children });
};
const SeriesSequence = core_1.Interactive.withSchema({
    Component: SeriesSequenceInner,
    componentName: '<TransitionSeries.Sequence>',
    componentIdentity: 'dev.remotion.transitions.TransitionSeries.Sequence',
    schema: transitionSeriesSequenceSchema,
    supportsEffects: false,
});
const transitionSeriesSchema = {
    ...core_1.Internals.sequenceSchema,
    ...core_1.Internals.sequenceTimingSchema,
};
const TransitionSeriesChildren = ({ children, }) => {
    const { fps } = (0, core_1.useVideoConfig)();
    const frame = (0, core_1.useCurrentFrame)();
    const prevImageRef = (0, react_1.useRef)({});
    const nextImageRef = (0, react_1.useRef)({});
    const pendingDeletions = core_1.Internals.usePendingSequenceDeletions();
    const flattedChildren = (0, react_1.useMemo)(() => {
        const flattened = (0, flatten_children_js_1.flattenChildren)(children);
        const deleted = flattened.map((child) => core_1.Internals.OptimisticSequenceDeletion.isElementDeleted(child, pendingDeletions));
        // A deleted sequence takes the transitions or overlays that would be left
        // dangling along, like the source codemod does. Otherwise two of them
        // would sit next to each other until the source file is reloaded.
        const kinds = flattened.map((child) => {
            if (!react_1.default.isValidElement(child)) {
                return 'other';
            }
            if (child.type === SeriesSequence) {
                return 'sequence';
            }
            if (child.type === TransitionSeriesTransition ||
                child.type === SeriesOverlay) {
                return 'connector';
            }
            return 'other';
        });
        if (kinds.some((kind, i) => kind === 'sequence' && deleted[i])) {
            for (const i of (0, find_dangling_connectors_js_1.findDanglingConnectors)({ kinds, deleted })) {
                deleted[i] = true;
            }
        }
        return flattened.filter((_, i) => !deleted[i]);
    }, [children, pendingDeletions]);
    const hasOverlay = flattedChildren.some((child) => react_1.default.isValidElement(child) && child.type === SeriesOverlay);
    const [overlayContainer, setOverlayContainer] = (0, react_1.useState)(null);
    const drawIfSynced = (0, react_1.useCallback)((index) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        var _j, _k, _l, _m, _o, _p;
        const prevImage = (_a = prevImageRef === null || prevImageRef === void 0 ? void 0 : prevImageRef.current) === null || _a === void 0 ? void 0 : _a[index];
        const nextImage = (_b = nextImageRef === null || nextImageRef === void 0 ? void 0 : nextImageRef.current) === null || _b === void 0 ? void 0 : _b[index];
        if (!(nextImage === null || nextImage === void 0 ? void 0 : nextImage.elementImage) && (prevImage === null || prevImage === void 0 ? void 0 : prevImage.elementImage)) {
            (_c = nextImage === null || nextImage === void 0 ? void 0 : nextImage.draw) === null || _c === void 0 ? void 0 : _c.call(nextImage, null, null, 0);
            (_d = prevImage === null || prevImage === void 0 ? void 0 : prevImage.draw) === null || _d === void 0 ? void 0 : _d.call(prevImage, (_j = prevImage === null || prevImage === void 0 ? void 0 : prevImage.elementImage) !== null && _j !== void 0 ? _j : null, null, 0);
            return;
        }
        if (!(prevImage === null || prevImage === void 0 ? void 0 : prevImage.elementImage) && (nextImage === null || nextImage === void 0 ? void 0 : nextImage.elementImage)) {
            (_e = prevImage === null || prevImage === void 0 ? void 0 : prevImage.draw) === null || _e === void 0 ? void 0 : _e.call(prevImage, null, null, 0);
            (_f = nextImage === null || nextImage === void 0 ? void 0 : nextImage.draw) === null || _f === void 0 ? void 0 : _f.call(nextImage, null, (_k = nextImage === null || nextImage === void 0 ? void 0 : nextImage.elementImage) !== null && _k !== void 0 ? _k : null, 0);
            return;
        }
        if ((prevImage && nextImage && prevImage.progress === nextImage.progress) ||
            !(prevImage === null || prevImage === void 0 ? void 0 : prevImage.elementImage) ||
            !(nextImage === null || nextImage === void 0 ? void 0 : nextImage.elementImage)) {
            (_g = prevImage === null || prevImage === void 0 ? void 0 : prevImage.draw) === null || _g === void 0 ? void 0 : _g.call(prevImage, (_l = prevImage === null || prevImage === void 0 ? void 0 : prevImage.elementImage) !== null && _l !== void 0 ? _l : null, (_m = nextImage === null || nextImage === void 0 ? void 0 : nextImage.elementImage) !== null && _m !== void 0 ? _m : null, (_p = (_o = prevImage === null || prevImage === void 0 ? void 0 : prevImage.progress) !== null && _o !== void 0 ? _o : nextImage === null || nextImage === void 0 ? void 0 : nextImage.progress) !== null && _p !== void 0 ? _p : 0);
            (_h = nextImage === null || nextImage === void 0 ? void 0 : nextImage.draw) === null || _h === void 0 ? void 0 : _h.call(nextImage, null, null, 0);
        }
    }, []);
    const onNextElementImage = (0, react_1.useCallback)((elementImage, progress, draw, index) => {
        prevImageRef.current[index] = { elementImage, progress, draw };
        drawIfSynced(index);
    }, [drawIfSynced]);
    const onPrevElementImage = (0, react_1.useCallback)((elementImage, progress, draw, index) => {
        nextImageRef.current[index] = { elementImage, progress, draw };
        drawIfSynced(index);
    }, [drawIfSynced]);
    const childrenValue = (0, react_1.useMemo)(() => {
        const renderOverlay = (info) => {
            var _a;
            return ((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: Math.round(info.overlayFrom), durationInFrames: info.durationInFrames, name: "<TS.Overlay>", _remotionInternalTimelineTrack: {
                    role: 'overlay',
                    seriesOffset: null,
                }, _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: (_a = info.controls) !== null && _a !== void 0 ? _a : undefined, hidden: info.hidden, layout: "absolute-fill", premountFor: info.premountFor, postmountFor: info.postmountFor, styleWhilePremounted: info.styleWhilePremounted, styleWhilePostmounted: info.styleWhilePostmounted, children: info.children }, `overlay-${info.index}`));
        };
        const renderChildren = (state) => {
            const { index: i, transitionOffsets, startFrame, overlayRenders, sequenceDurations, pendingOverlayValidation, } = state;
            if (i === flattedChildren.length) {
                return overlayContainer === null
                    ? overlayRenders.map(renderOverlay)
                    : null;
            }
            const child = flattedChildren[i];
            const current = child;
            const renderNext = (overrides = {}) => {
                return renderChildren({ ...state, ...overrides, index: i + 1 });
            };
            if (typeof current === 'string') {
                // Don't throw if it's just some accidential whitespace
                if (current.trim() === '') {
                    return renderNext();
                }
                throw new TypeError(`The <TransitionSeries /> component only accepts a list of <TransitionSeries.Sequence /> components as its children, but you passed a string "${current}"`);
            }
            const hasPrev = flattedChildren[i - 1];
            const nextPrev = flattedChildren[i + 1];
            const prevIsTransition = typeof hasPrev === 'string' || typeof hasPrev === 'undefined'
                ? false
                : hasPrev.type === TransitionSeriesTransition;
            const prevIsOverlay = typeof hasPrev === 'string' || typeof hasPrev === 'undefined'
                ? false
                : hasPrev.type === SeriesOverlay;
            // Handle overlay
            if (current.type === SeriesOverlay) {
                // Validate: two overlays in a row
                if (prevIsOverlay) {
                    throw new TypeError(`A <TransitionSeries.Overlay /> component must not be followed by another <TransitionSeries.Overlay /> component (nth children = ${i - 1} and ${i})`);
                }
                // Validate: overlay next to transition
                if (prevIsTransition) {
                    throw new TypeError(`A <TransitionSeries.Transition /> component must not be followed by a <TransitionSeries.Overlay /> component (nth children = ${i - 1} and ${i})`);
                }
                const nextIsTransition = typeof nextPrev === 'string' || typeof nextPrev === 'undefined'
                    ? false
                    : nextPrev.type === TransitionSeriesTransition;
                if (nextIsTransition) {
                    throw new TypeError(`A <TransitionSeries.Overlay /> component must not be followed by a <TransitionSeries.Transition /> component (nth children = ${i} and ${i + 1})`);
                }
                const castedOverlay = current;
                return react_1.default.cloneElement(castedOverlay, {
                    _remotionInternalRender: (overlayProps) => {
                        var _a;
                        (0, validate_js_1.validateDurationInFrames)(overlayProps.durationInFrames, {
                            component: `of a <TransitionSeries.Overlay /> component`,
                            allowFloats: false,
                        });
                        const overlayOffset = (_a = overlayProps.offset) !== null && _a !== void 0 ? _a : 0;
                        if (Number.isNaN(overlayOffset)) {
                            throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must not be NaN, but got NaN.`);
                        }
                        if (!Number.isFinite(overlayOffset)) {
                            throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must be finite, but got ${overlayOffset}.`);
                        }
                        if (overlayOffset % 1 !== 0) {
                            throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must be an integer, but got ${overlayOffset}.`);
                        }
                        // Find the previous sequence (the cut point is at startFrame + transitionOffsets)
                        const cutPoint = startFrame + transitionOffsets;
                        const halfDuration = overlayProps.durationInFrames / 2;
                        const overlayFrom = cutPoint - halfDuration + overlayOffset;
                        if (overlayFrom < 0) {
                            throw new TypeError(`A <TransitionSeries.Overlay /> extends before frame 0. The overlay starts at frame ${overlayFrom}. Reduce the duration or adjust the offset.`);
                        }
                        // Validate: overlay must not exceed the previous sequence duration
                        const prevSeqIdx = sequenceDurations.length - 1;
                        if (prevSeqIdx >= 0) {
                            const overlayStartInPrev = halfDuration - overlayOffset;
                            if (overlayStartInPrev > sequenceDurations[prevSeqIdx]) {
                                throw new TypeError(`A <TransitionSeries.Overlay /> extends beyond the previous sequence. The overlay needs ${overlayStartInPrev} frames before the cut, but the previous sequence is only ${sequenceDurations[prevSeqIdx]} frames long.`);
                            }
                        }
                        // Store overlay info to validate the other side once the next
                        // sequence has resolved its interactive props.
                        const overlayRender = {
                            overlayFrom,
                            durationInFrames: overlayProps.durationInFrames,
                            overlayOffset,
                            halfDuration,
                            children: overlayProps.children,
                            index: i,
                            controls: overlayProps.controls,
                            hidden: overlayProps.hidden,
                            premountFor: overlayProps.premountFor,
                            postmountFor: overlayProps.postmountFor,
                            styleWhilePremounted: overlayProps.styleWhilePremounted,
                            styleWhilePostmounted: overlayProps.styleWhilePostmounted,
                        };
                        const rest = renderNext({
                            overlayRenders: [...overlayRenders, overlayRender],
                            pendingOverlayValidation: true,
                        });
                        // Register the overlay in source order while keeping its DOM at the end.
                        return overlayContainer === null ? (rest) : ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, react_dom_1.createPortal)(renderOverlay(overlayRender), overlayContainer, `overlay-${i}`), rest] }));
                    },
                });
            }
            if (current.type === TransitionSeriesTransition) {
                if (prevIsTransition) {
                    throw new TypeError(`A <TransitionSeries.Transition /> component must not be followed by another <TransitionSeries.Transition /> component (nth children = ${i - 1} and ${i})`);
                }
                if (prevIsOverlay) {
                    throw new TypeError(`A <TransitionSeries.Overlay /> component must not be followed by a <TransitionSeries.Transition /> component (nth children = ${i - 1} and ${i})`);
                }
                const castedTransition = current;
                return react_1.default.cloneElement(castedTransition, {
                    _remotionInternalRender: (transitionProps) => {
                        var _a;
                        const transitionDuration = transitionProps.timing.getDurationInFrames({ fps });
                        const transitionFrom = startFrame + transitionOffsets - transitionDuration;
                        return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [transitionDuration > 0 ? ((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: transitionFrom, durationInFrames: transitionDuration, name: "<TS.Transition>", _remotionInternalTimelineTrack: {
                                        role: 'transition',
                                        seriesOffset: null,
                                    }, _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: (_a = transitionProps.controls) !== null && _a !== void 0 ? _a : undefined, layout: "none" })) : null, renderNext()] }));
                    },
                });
            }
            if (current.type !== SeriesSequence) {
                throw new TypeError(`The <TransitionSeries /> component only accepts a list of <TransitionSeries.Sequence />, <TransitionSeries.Transition />, and <TransitionSeries.Overlay /> components as its children, but got ${current} instead`);
            }
            const prev = typeof hasPrev === 'string' || typeof hasPrev === 'undefined'
                ? null
                : hasPrev.type === TransitionSeriesTransition
                    ? hasPrev
                    : null;
            const next = typeof nextPrev === 'string' || typeof nextPrev === 'undefined'
                ? null
                : nextPrev.type === TransitionSeriesTransition
                    ? nextPrev
                    : null;
            const castedChildAgain = current;
            return react_1.default.cloneElement(castedChildAgain, {
                _remotionInternalRender: (resolvedProps) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                    const durationInFramesProp = resolvedProps.durationInFrames;
                    const timelineDurationInFrames = durationInFramesProp / ((_a = resolvedProps.playbackRate) !== null && _a !== void 0 ? _a : 1);
                    if (resolvedProps.loop) {
                        throw new Error('<TransitionSeries.Sequence> does not accept `loop`. Put a looping <Sequence> inside the <TransitionSeries.Sequence> instead.');
                    }
                    const debugInfo = `index = ${i}, duration = ${durationInFramesProp}`;
                    const { durationInFrames, children: sequenceChildren, offset: offsetProp, controls, from: _from, ...passedProps } = resolvedProps;
                    const propsForSequence = {
                        ...passedProps,
                        _remotionInternalTimelineTrack: {
                            role: 'clip',
                            seriesOffset: offsetProp !== null && offsetProp !== void 0 ? offsetProp : 0,
                        },
                        _remotionInternalSingleChildren: sequenceChildren,
                    };
                    (0, validate_js_1.validateDurationInFrames)(durationInFramesProp, {
                        component: `of a <TransitionSeries.Sequence /> component`,
                        allowFloats: true,
                    });
                    const offset = offsetProp !== null && offsetProp !== void 0 ? offsetProp : 0;
                    if (Number.isNaN(offset)) {
                        throw new TypeError(`The "offset" property of a <TransitionSeries.Sequence /> must not be NaN, but got NaN (${debugInfo}).`);
                    }
                    if (!Number.isFinite(offset)) {
                        throw new TypeError(`The "offset" property of a <TransitionSeries.Sequence /> must be finite, but got ${offset} (${debugInfo}).`);
                    }
                    if (offset % 1 !== 0) {
                        throw new TypeError(`The "offset" property of a <TransitionSeries.Sequence /> must be finite, but got ${offset} (${debugInfo}).`);
                    }
                    let resolvedTransitionOffsets = transitionOffsets;
                    let resolvedStartFrame = startFrame;
                    let resolvedPendingOverlayValidation = pendingOverlayValidation;
                    const currentStartFrame = resolvedStartFrame + offset;
                    let duration = 0;
                    if (prev) {
                        duration = prev.props.timing.getDurationInFrames({
                            fps,
                        });
                        resolvedTransitionOffsets -= duration;
                    }
                    let actualStartFrame = currentStartFrame + resolvedTransitionOffsets;
                    resolvedStartFrame += timelineDurationInFrames + offset;
                    // Handle the case where the first item is a transition
                    if (actualStartFrame < 0) {
                        resolvedStartFrame -= actualStartFrame;
                        actualStartFrame = 0;
                    }
                    // Track resolved durations so later sequences and overlay validation use
                    // the live Studio override instead of the original JSX value.
                    const nextSequenceDurations = [
                        ...sequenceDurations,
                        timelineDurationInFrames,
                    ];
                    // Validate: check if a preceding overlay extends beyond this sequence
                    if (resolvedPendingOverlayValidation) {
                        resolvedPendingOverlayValidation = false;
                        const lastOverlay = overlayRenders[overlayRenders.length - 1];
                        if (!lastOverlay) {
                            throw new Error('Expected an overlay to validate');
                        }
                        const framesAfterCut = lastOverlay.halfDuration + lastOverlay.overlayOffset;
                        if (framesAfterCut > timelineDurationInFrames) {
                            throw new TypeError(`A <TransitionSeries.Overlay /> extends beyond the next sequence. The overlay needs ${framesAfterCut} frames after the cut, but the next sequence is only ${timelineDurationInFrames} frames long.`);
                        }
                    }
                    const renderSequenceAndRest = (sequence) => {
                        return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [sequence, renderNext({
                                    transitionOffsets: resolvedTransitionOffsets,
                                    startFrame: resolvedStartFrame,
                                    sequenceDurations: nextSequenceDurations,
                                    pendingOverlayValidation: resolvedPendingOverlayValidation,
                                })] }));
                    };
                    const nextProgress = next
                        ? next.props.timing.getProgress({
                            frame: frame -
                                actualStartFrame -
                                timelineDurationInFrames +
                                next.props.timing.getDurationInFrames({ fps }),
                            fps,
                        })
                        : null;
                    const prevProgress = prev
                        ? prev.props.timing.getProgress({
                            frame: frame - actualStartFrame,
                            fps,
                        })
                        : null;
                    if (next &&
                        timelineDurationInFrames <
                            next.props.timing.getDurationInFrames({ fps })) {
                        throw new Error(`The duration of a <TransitionSeries.Sequence /> must not be shorter than the duration of the next <TransitionSeries.Transition />. The transition is ${next.props.timing.getDurationInFrames({ fps })} frames long, but the sequence is only ${timelineDurationInFrames} frames long (${debugInfo})`);
                    }
                    if (prev &&
                        timelineDurationInFrames <
                            prev.props.timing.getDurationInFrames({ fps })) {
                        throw new Error(`The duration of a <TransitionSeries.Sequence /> must not be shorter than the duration of the previous <TransitionSeries.Transition />. The transition is ${prev.props.timing.getDurationInFrames({ fps })} frames long, but the sequence is only ${timelineDurationInFrames} frames long (${debugInfo})`);
                    }
                    if (next && prev && nextProgress !== null && prevProgress !== null) {
                        const nextPresentation = (_b = next.props.presentation) !== null && _b !== void 0 ? _b : (0, slide_js_1.slide)();
                        const prevPresentation = (_c = prev.props.presentation) !== null && _c !== void 0 ? _c : (0, slide_js_1.slide)();
                        const UppercaseNextPresentation = nextPresentation.component;
                        const UppercasePrevPresentation = prevPresentation.component;
                        return renderSequenceAndRest((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: actualStartFrame, durationInFrames: durationInFramesProp, ...propsForSequence, name: passedProps.name || '<TS.Sequence>', _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: controls !== null && controls !== void 0 ? controls : undefined, children: (0, jsx_runtime_1.jsx)(UppercaseNextPresentation, { passedProps: (_d = nextPresentation.props) !== null && _d !== void 0 ? _d : {}, presentationDirection: "exiting", presentationProgress: nextProgress, presentationDurationInFrames: next.props.timing.getDurationInFrames({ fps }), onElementImage: () => {
                                    throw new Error('Should not call when exiting');
                                }, onUnmount: () => {
                                    throw new Error('Should not call when exiting');
                                }, bothEnteringAndExiting: true, children: (0, jsx_runtime_1.jsx)(context_js_1.WrapInExitingProgressContext, { presentationProgress: nextProgress, children: (0, jsx_runtime_1.jsx)(UppercasePrevPresentation, { passedProps: (_e = prevPresentation.props) !== null && _e !== void 0 ? _e : {}, presentationDirection: "entering", presentationProgress: prevProgress, presentationDurationInFrames: prev.props.timing.getDurationInFrames({ fps }), onElementImage: (elementImage, draw) => {
                                            onPrevElementImage(elementImage, nextProgress, draw, i + 1);
                                            onNextElementImage(elementImage, prevProgress, draw, i - 1);
                                        }, onUnmount: () => {
                                            onPrevElementImage(null, null, null, i + 1);
                                            onNextElementImage(null, null, null, i - 1);
                                        }, bothEnteringAndExiting: true, children: (0, jsx_runtime_1.jsx)(context_js_1.WrapInEnteringProgressContext, { presentationProgress: prevProgress, children: sequenceChildren }) }) }) }) }, i));
                    }
                    if (prevProgress !== null && prev) {
                        const prevPresentation = (_f = prev.props.presentation) !== null && _f !== void 0 ? _f : (0, slide_js_1.slide)();
                        const UppercasePrevPresentation = prevPresentation.component;
                        return renderSequenceAndRest((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: actualStartFrame, durationInFrames: durationInFramesProp, ...propsForSequence, name: passedProps.name || '<TS.Sequence>', _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: controls !== null && controls !== void 0 ? controls : undefined, children: (0, jsx_runtime_1.jsx)(UppercasePrevPresentation, { passedProps: (_g = prevPresentation.props) !== null && _g !== void 0 ? _g : {}, presentationDirection: "entering", presentationProgress: prevProgress, presentationDurationInFrames: prev.props.timing.getDurationInFrames({ fps }), onElementImage: (elementImage, draw) => onNextElementImage(elementImage, prevProgress, draw, i - 1), onUnmount: () => {
                                    onNextElementImage(null, null, null, i - 1);
                                }, bothEnteringAndExiting: false, children: (0, jsx_runtime_1.jsx)(context_js_1.WrapInEnteringProgressContext, { presentationProgress: prevProgress, children: sequenceChildren }) }) }, i));
                    }
                    if (nextProgress !== null && next) {
                        const nextPresentation = (_h = next.props.presentation) !== null && _h !== void 0 ? _h : (0, slide_js_1.slide)();
                        const UppercaseNextPresentation = nextPresentation.component;
                        return renderSequenceAndRest((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: actualStartFrame, durationInFrames: durationInFramesProp, ...propsForSequence, name: passedProps.name || '<TS.Sequence>', _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: controls !== null && controls !== void 0 ? controls : undefined, children: (0, jsx_runtime_1.jsx)(UppercaseNextPresentation, { passedProps: (_j = nextPresentation.props) !== null && _j !== void 0 ? _j : {}, presentationDirection: "exiting", presentationProgress: nextProgress, presentationDurationInFrames: next.props.timing.getDurationInFrames({ fps }), onElementImage: (elementImage, draw) => onPrevElementImage(elementImage, nextProgress, draw, i + 1), onUnmount: () => {
                                    onPrevElementImage(null, null, null, i + 1);
                                }, bothEnteringAndExiting: false, children: (0, jsx_runtime_1.jsx)(context_js_1.WrapInExitingProgressContext, { presentationProgress: nextProgress, children: sequenceChildren }) }) }, i));
                    }
                    return renderSequenceAndRest((0, jsx_runtime_1.jsx)(SequenceWithoutSchema, { from: actualStartFrame, durationInFrames: durationInFramesProp, ...propsForSequence, name: passedProps.name || '<TS.Sequence>', _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", controls: controls !== null && controls !== void 0 ? controls : undefined, children: sequenceChildren }, i));
                },
            });
        };
        return renderChildren({
            index: 0,
            transitionOffsets: 0,
            startFrame: 0,
            overlayRenders: [],
            sequenceDurations: [],
            pendingOverlayValidation: false,
        });
    }, [
        flattedChildren,
        fps,
        frame,
        onPrevElementImage,
        onNextElementImage,
        overlayContainer,
    ]);
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [childrenValue, hasOverlay ? ((0, jsx_runtime_1.jsx)("div", { ref: setOverlayContainer, style: { display: 'contents' } })) : null] }));
};
/*
 * @description Manages a series of transitions and sequences for advanced animation controls in MotionMox projects, handling cases with varying timings and presentations.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/transitionseries)
 */
const TransitionSeriesInner = (props) => {
    var _a;
    const { children, name, layout: passedLayout, controls, } = props;
    const displayName = name !== null && name !== void 0 ? name : '<TransitionSeries>';
    const layout = passedLayout !== null && passedLayout !== void 0 ? passedLayout : 'absolute-fill';
    const trackProps = props.layout === 'none'
        ? props
        : { ...props, layout: (_a = props.layout) !== null && _a !== void 0 ? _a : 'absolute-fill' };
    if (no_react_1.NoReactInternals.ENABLE_V5_BREAKING_CHANGES &&
        layout !== 'absolute-fill') {
        throw new TypeError(`The "layout" prop of <TransitionSeries /> is not supported anymore in v5. TransitionSeries' must be absolutely positioned.`);
    }
    return ((0, jsx_runtime_1.jsx)(TrackWithoutSchema, { _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries", ...trackProps, name: displayName, controls: controls !== null && controls !== void 0 ? controls : undefined, children: (0, jsx_runtime_1.jsx)(TransitionSeriesChildren, { children: children }) }));
};
const TransitionSeries = core_1.Interactive.withSchema({
    Component: TransitionSeriesInner,
    componentName: '<TransitionSeries>',
    componentIdentity: 'dev.remotion.transitions.TransitionSeries',
    schema: transitionSeriesSchema,
    supportsEffects: false,
});
exports.TransitionSeries = TransitionSeries;
TransitionSeries.Sequence = SeriesSequence;
TransitionSeries.Transition = TransitionSeriesTransition;
TransitionSeries.Overlay = SeriesOverlay;
