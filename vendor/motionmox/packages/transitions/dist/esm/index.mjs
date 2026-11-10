// src/timings/linear-timing.ts
import { interpolate } from "@motionmox/core";
var linearTiming = (options) => {
  return {
    getDurationInFrames: () => {
      return options.durationInFrames;
    },
    getProgress: ({ frame }) => {
      return interpolate(frame, [0, options.durationInFrames], [0, 1], {
        easing: options.easing,
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp"
      });
    }
  };
};
// src/timings/spring-timing.ts
import { measureSpring, spring } from "@motionmox/core";
var springTiming = (options = {}) => {
  return {
    getDurationInFrames: ({ fps }) => {
      if (options.durationInFrames) {
        return options.durationInFrames;
      }
      return measureSpring({
        config: options.config,
        threshold: options.durationRestThreshold,
        fps
      });
    },
    getProgress: ({ fps, frame }) => {
      const to = options.reverse ? 0 : 1;
      const from = options.reverse ? 1 : 0;
      return spring({
        fps,
        frame,
        to,
        from,
        config: options.config,
        durationInFrames: options.durationInFrames,
        durationRestThreshold: options.durationRestThreshold,
        reverse: options.reverse
      });
    }
  };
};
// src/TransitionSeries.tsx
import React4, { useCallback, useMemo as useMemo3, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Internals,
  Interactive,
  useCurrentFrame,
  useVideoConfig
} from "@motionmox/core";
import { NoReactInternals as NoReactInternals2 } from "@motionmox/core/no-react";

// src/context.tsx
import React, { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
var EnteringContext = React.createContext(null);
var ExitingContext = React.createContext(null);
var WrapInEnteringProgressContext = ({ presentationProgress, children }) => {
  const value = useMemo(() => {
    return {
      enteringProgress: presentationProgress
    };
  }, [presentationProgress]);
  return /* @__PURE__ */ jsx(EnteringContext.Provider, {
    value,
    children
  });
};
var WrapInExitingProgressContext = ({ presentationProgress, children }) => {
  const value = useMemo(() => {
    return {
      exitingProgress: presentationProgress
    };
  }, [presentationProgress]);
  return /* @__PURE__ */ jsx(ExitingContext.Provider, {
    value,
    children
  });
};

// src/find-dangling-connectors.ts
var findDanglingConnectors = ({
  kinds,
  deleted
}) => {
  const gone = [...deleted];
  const dangling = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = kinds.length - 1;i >= 0; i--) {
      if (kinds[i] !== "connector" || gone[i]) {
        continue;
      }
      if (!(gone[i - 1] ?? false) && !(gone[i + 1] ?? false)) {
        continue;
      }
      let left = i - 1;
      while (left >= 0 && gone[left]) {
        left--;
      }
      let right = i + 1;
      while (right < kinds.length && gone[right]) {
        right++;
      }
      const atStart = left < 0 && i === 0;
      const atEnd = right >= kinds.length && i === kinds.length - 1;
      const leftOk = left < 0 ? i === 0 : kinds[left] !== "connector" || atEnd && left !== 0;
      const rightOk = right >= kinds.length ? i === kinds.length - 1 : kinds[right] !== "connector" || atStart && right !== kinds.length - 1;
      if (leftOk && rightOk) {
        continue;
      }
      gone[i] = true;
      dangling.push(i);
      changed = true;
    }
  }
  return dangling;
};

// src/flatten-children.ts
import React2 from "react";
var flattenChildren = (children) => {
  const childrenArray = React2.Children.toArray(children);
  return childrenArray.reduce((flatChildren, child) => {
    if (child.type === React2.Fragment) {
      return flatChildren.concat(flattenChildren(child.props.children));
    }
    flatChildren.push(child);
    return flatChildren;
  }, []);
};

// src/presentations/slide.tsx
import { useMemo as useMemo2 } from "react";
import { AbsoluteFill } from "@motionmox/core";
import { jsx as jsx2 } from "react/jsx-runtime";
var epsilon = 0.01;
var SlidePresentation = ({
  children,
  presentationProgress,
  presentationDirection,
  passedProps: { direction = "from-left", enterStyle, exitStyle }
}) => {
  const directionStyle = useMemo2(() => {
    const presentationProgressWithEpsilonCorrection = presentationProgress === 1 ? presentationProgress * 100 : presentationProgress * 100 - epsilon;
    if (presentationDirection === "exiting") {
      switch (direction) {
        case "from-left":
          return {
            transform: `translateX(${presentationProgressWithEpsilonCorrection}%)`
          };
        case "from-right":
          return {
            transform: `translateX(${-presentationProgress * 100}%)`
          };
        case "from-top":
          return {
            transform: `translateY(${presentationProgressWithEpsilonCorrection}%)`
          };
        case "from-bottom":
          return {
            transform: `translateY(${-presentationProgress * 100}%)`
          };
        default:
          throw new Error(`Invalid direction: ${direction}`);
      }
    }
    switch (direction) {
      case "from-left":
        return {
          transform: `translateX(${-100 + presentationProgress * 100}%)`
        };
      case "from-right":
        return {
          transform: `translateX(${100 - presentationProgressWithEpsilonCorrection}%)`
        };
      case "from-top":
        return {
          transform: `translateY(${-100 + presentationProgress * 100}%)`
        };
      case "from-bottom":
        return {
          transform: `translateY(${100 - presentationProgressWithEpsilonCorrection}%)`
        };
      default:
        throw new Error(`Invalid direction: ${direction}`);
    }
  }, [presentationDirection, presentationProgress, direction]);
  const style = useMemo2(() => {
    return {
      width: "100%",
      height: "100%",
      justifyContent: "center",
      alignItems: "center",
      ...directionStyle,
      ...presentationDirection === "entering" ? enterStyle : exitStyle
    };
  }, [directionStyle, enterStyle, exitStyle, presentationDirection]);
  return /* @__PURE__ */ jsx2(AbsoluteFill, {
    showInTimeline: false,
    style,
    children
  });
};
var slide = (props) => {
  return {
    component: SlidePresentation,
    props: props ?? {}
  };
};

// src/validate.ts
import { NoReactInternals } from "@motionmox/core/no-react";
var validateDurationInFrames = NoReactInternals.validateDurationInFrames;

// src/TransitionSeries.tsx
import { jsx as jsx3, jsxs, Fragment } from "react/jsx-runtime";
var { SequenceWithoutSchema, TrackWithoutSchema } = Internals;
var TransitionSeriesTransitionInner = ({
  _remotionInternalRender = null,
  ...props
}) => {
  if (_remotionInternalRender) {
    return _remotionInternalRender(props);
  }
  return null;
};
var transitionSeriesTransitionSchema = {};
var TransitionSeriesTransition = Interactive.withSchema({
  Component: TransitionSeriesTransitionInner,
  componentName: "<TransitionSeries.Transition>",
  componentIdentity: "dev.remotion.transitions.TransitionSeries.Transition",
  schema: transitionSeriesTransitionSchema,
  supportsEffects: false
});
var SeriesOverlayInner = ({
  _remotionInternalRender = null,
  ...props
}) => {
  if (_remotionInternalRender) {
    return _remotionInternalRender(props);
  }
  return null;
};
var transitionSeriesOverlaySchema = {
  hidden: Internals.sequenceSchema.hidden
};
var SeriesOverlay = Interactive.withSchema({
  Component: SeriesOverlayInner,
  componentName: "<TransitionSeries.Overlay>",
  componentIdentity: "dev.remotion.transitions.TransitionSeries.Overlay",
  schema: transitionSeriesOverlaySchema,
  supportsEffects: false
});
var transitionSeriesSequenceSchema = {
  durationInFrames: Internals.durationInFramesField,
  name: Internals.sequenceSchema.name,
  hidden: Internals.sequenceSchema.hidden,
  showInTimeline: Internals.sequenceSchema.showInTimeline,
  freeze: Internals.freezeField,
  trimBefore: Internals.sequenceSchema.trimBefore,
  playbackRate: Internals.sequenceSchema.playbackRate,
  layout: Internals.sequenceSchema.layout
};
var SeriesSequenceInner = ({
  offset = 0,
  className = "",
  _remotionInternalRender = null,
  ...props
}) => {
  if (_remotionInternalRender) {
    return _remotionInternalRender({
      ...props,
      offset,
      className: className || undefined
    });
  }
  return /* @__PURE__ */ jsx3(Fragment, {
    children: props.children
  });
};
var SeriesSequence = Interactive.withSchema({
  Component: SeriesSequenceInner,
  componentName: "<TransitionSeries.Sequence>",
  componentIdentity: "dev.remotion.transitions.TransitionSeries.Sequence",
  schema: transitionSeriesSequenceSchema,
  supportsEffects: false
});
var transitionSeriesSchema = {
  ...Internals.sequenceSchema,
  ...Internals.sequenceTimingSchema
};
var TransitionSeriesChildren = ({
  children
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const prevImageRef = useRef({});
  const nextImageRef = useRef({});
  const pendingDeletions = Internals.usePendingSequenceDeletions();
  const flattedChildren = useMemo3(() => {
    const flattened = flattenChildren(children);
    const deleted = flattened.map((child) => Internals.OptimisticSequenceDeletion.isElementDeleted(child, pendingDeletions));
    const kinds = flattened.map((child) => {
      if (!React4.isValidElement(child)) {
        return "other";
      }
      if (child.type === SeriesSequence) {
        return "sequence";
      }
      if (child.type === TransitionSeriesTransition || child.type === SeriesOverlay) {
        return "connector";
      }
      return "other";
    });
    if (kinds.some((kind, i) => kind === "sequence" && deleted[i])) {
      for (const i of findDanglingConnectors({ kinds, deleted })) {
        deleted[i] = true;
      }
    }
    return flattened.filter((_, i) => !deleted[i]);
  }, [children, pendingDeletions]);
  const hasOverlay = flattedChildren.some((child) => React4.isValidElement(child) && child.type === SeriesOverlay);
  const [overlayContainer, setOverlayContainer] = useState(null);
  const drawIfSynced = useCallback((index) => {
    const prevImage = prevImageRef?.current?.[index];
    const nextImage = nextImageRef?.current?.[index];
    if (!nextImage?.elementImage && prevImage?.elementImage) {
      nextImage?.draw?.(null, null, 0);
      prevImage?.draw?.(prevImage?.elementImage ?? null, null, 0);
      return;
    }
    if (!prevImage?.elementImage && nextImage?.elementImage) {
      prevImage?.draw?.(null, null, 0);
      nextImage?.draw?.(null, nextImage?.elementImage ?? null, 0);
      return;
    }
    if (prevImage && nextImage && prevImage.progress === nextImage.progress || !prevImage?.elementImage || !nextImage?.elementImage) {
      prevImage?.draw?.(prevImage?.elementImage ?? null, nextImage?.elementImage ?? null, prevImage?.progress ?? nextImage?.progress ?? 0);
      nextImage?.draw?.(null, null, 0);
    }
  }, []);
  const onNextElementImage = useCallback((elementImage, progress, draw, index) => {
    prevImageRef.current[index] = { elementImage, progress, draw };
    drawIfSynced(index);
  }, [drawIfSynced]);
  const onPrevElementImage = useCallback((elementImage, progress, draw, index) => {
    nextImageRef.current[index] = { elementImage, progress, draw };
    drawIfSynced(index);
  }, [drawIfSynced]);
  const childrenValue = useMemo3(() => {
    const renderOverlay = (info) => /* @__PURE__ */ jsx3(SequenceWithoutSchema, {
      from: Math.round(info.overlayFrom),
      durationInFrames: info.durationInFrames,
      name: "<TS.Overlay>",
      _remotionInternalTimelineTrack: {
        role: "overlay",
        seriesOffset: null
      },
      _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
      controls: info.controls ?? undefined,
      hidden: info.hidden,
      layout: "absolute-fill",
      premountFor: info.premountFor,
      postmountFor: info.postmountFor,
      styleWhilePremounted: info.styleWhilePremounted,
      styleWhilePostmounted: info.styleWhilePostmounted,
      children: info.children
    }, `overlay-${info.index}`);
    const renderChildren = (state) => {
      const {
        index: i,
        transitionOffsets,
        startFrame,
        overlayRenders,
        sequenceDurations,
        pendingOverlayValidation
      } = state;
      if (i === flattedChildren.length) {
        return overlayContainer === null ? overlayRenders.map(renderOverlay) : null;
      }
      const child = flattedChildren[i];
      const current = child;
      const renderNext = (overrides = {}) => {
        return renderChildren({ ...state, ...overrides, index: i + 1 });
      };
      if (typeof current === "string") {
        if (current.trim() === "") {
          return renderNext();
        }
        throw new TypeError(`The <TransitionSeries /> component only accepts a list of <TransitionSeries.Sequence /> components as its children, but you passed a string "${current}"`);
      }
      const hasPrev = flattedChildren[i - 1];
      const nextPrev = flattedChildren[i + 1];
      const prevIsTransition = typeof hasPrev === "string" || typeof hasPrev === "undefined" ? false : hasPrev.type === TransitionSeriesTransition;
      const prevIsOverlay = typeof hasPrev === "string" || typeof hasPrev === "undefined" ? false : hasPrev.type === SeriesOverlay;
      if (current.type === SeriesOverlay) {
        if (prevIsOverlay) {
          throw new TypeError(`A <TransitionSeries.Overlay /> component must not be followed by another <TransitionSeries.Overlay /> component (nth children = ${i - 1} and ${i})`);
        }
        if (prevIsTransition) {
          throw new TypeError(`A <TransitionSeries.Transition /> component must not be followed by a <TransitionSeries.Overlay /> component (nth children = ${i - 1} and ${i})`);
        }
        const nextIsTransition = typeof nextPrev === "string" || typeof nextPrev === "undefined" ? false : nextPrev.type === TransitionSeriesTransition;
        if (nextIsTransition) {
          throw new TypeError(`A <TransitionSeries.Overlay /> component must not be followed by a <TransitionSeries.Transition /> component (nth children = ${i} and ${i + 1})`);
        }
        const castedOverlay = current;
        return React4.cloneElement(castedOverlay, {
          _remotionInternalRender: (overlayProps) => {
            validateDurationInFrames(overlayProps.durationInFrames, {
              component: `of a <TransitionSeries.Overlay /> component`,
              allowFloats: false
            });
            const overlayOffset = overlayProps.offset ?? 0;
            if (Number.isNaN(overlayOffset)) {
              throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must not be NaN, but got NaN.`);
            }
            if (!Number.isFinite(overlayOffset)) {
              throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must be finite, but got ${overlayOffset}.`);
            }
            if (overlayOffset % 1 !== 0) {
              throw new TypeError(`The "offset" property of a <TransitionSeries.Overlay /> must be an integer, but got ${overlayOffset}.`);
            }
            const cutPoint = startFrame + transitionOffsets;
            const halfDuration = overlayProps.durationInFrames / 2;
            const overlayFrom = cutPoint - halfDuration + overlayOffset;
            if (overlayFrom < 0) {
              throw new TypeError(`A <TransitionSeries.Overlay /> extends before frame 0. The overlay starts at frame ${overlayFrom}. Reduce the duration or adjust the offset.`);
            }
            const prevSeqIdx = sequenceDurations.length - 1;
            if (prevSeqIdx >= 0) {
              const overlayStartInPrev = halfDuration - overlayOffset;
              if (overlayStartInPrev > sequenceDurations[prevSeqIdx]) {
                throw new TypeError(`A <TransitionSeries.Overlay /> extends beyond the previous sequence. The overlay needs ${overlayStartInPrev} frames before the cut, but the previous sequence is only ${sequenceDurations[prevSeqIdx]} frames long.`);
              }
            }
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
              styleWhilePostmounted: overlayProps.styleWhilePostmounted
            };
            const rest = renderNext({
              overlayRenders: [...overlayRenders, overlayRender],
              pendingOverlayValidation: true
            });
            return overlayContainer === null ? rest : /* @__PURE__ */ jsxs(Fragment, {
              children: [
                createPortal(renderOverlay(overlayRender), overlayContainer, `overlay-${i}`),
                rest
              ]
            });
          }
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
        return React4.cloneElement(castedTransition, {
          _remotionInternalRender: (transitionProps) => {
            const transitionDuration = transitionProps.timing.getDurationInFrames({ fps });
            const transitionFrom = startFrame + transitionOffsets - transitionDuration;
            return /* @__PURE__ */ jsxs(Fragment, {
              children: [
                transitionDuration > 0 ? /* @__PURE__ */ jsx3(SequenceWithoutSchema, {
                  from: transitionFrom,
                  durationInFrames: transitionDuration,
                  name: "<TS.Transition>",
                  _remotionInternalTimelineTrack: {
                    role: "transition",
                    seriesOffset: null
                  },
                  _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
                  controls: transitionProps.controls ?? undefined,
                  layout: "none"
                }) : null,
                renderNext()
              ]
            });
          }
        });
      }
      if (current.type !== SeriesSequence) {
        throw new TypeError(`The <TransitionSeries /> component only accepts a list of <TransitionSeries.Sequence />, <TransitionSeries.Transition />, and <TransitionSeries.Overlay /> components as its children, but got ${current} instead`);
      }
      const prev = typeof hasPrev === "string" || typeof hasPrev === "undefined" ? null : hasPrev.type === TransitionSeriesTransition ? hasPrev : null;
      const next = typeof nextPrev === "string" || typeof nextPrev === "undefined" ? null : nextPrev.type === TransitionSeriesTransition ? nextPrev : null;
      const castedChildAgain = current;
      return React4.cloneElement(castedChildAgain, {
        _remotionInternalRender: (resolvedProps) => {
          const durationInFramesProp = resolvedProps.durationInFrames;
          const timelineDurationInFrames = durationInFramesProp / (resolvedProps.playbackRate ?? 1);
          if (resolvedProps.loop) {
            throw new Error("<TransitionSeries.Sequence> does not accept `loop`. Put a looping <Sequence> inside the <TransitionSeries.Sequence> instead.");
          }
          const debugInfo = `index = ${i}, duration = ${durationInFramesProp}`;
          const {
            durationInFrames,
            children: sequenceChildren,
            offset: offsetProp,
            controls,
            from: _from,
            ...passedProps
          } = resolvedProps;
          const propsForSequence = {
            ...passedProps,
            _remotionInternalTimelineTrack: {
              role: "clip",
              seriesOffset: offsetProp ?? 0
            },
            _remotionInternalSingleChildren: sequenceChildren
          };
          validateDurationInFrames(durationInFramesProp, {
            component: `of a <TransitionSeries.Sequence /> component`,
            allowFloats: true
          });
          const offset = offsetProp ?? 0;
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
              fps
            });
            resolvedTransitionOffsets -= duration;
          }
          let actualStartFrame = currentStartFrame + resolvedTransitionOffsets;
          resolvedStartFrame += timelineDurationInFrames + offset;
          if (actualStartFrame < 0) {
            resolvedStartFrame -= actualStartFrame;
            actualStartFrame = 0;
          }
          const nextSequenceDurations = [
            ...sequenceDurations,
            timelineDurationInFrames
          ];
          if (resolvedPendingOverlayValidation) {
            resolvedPendingOverlayValidation = false;
            const lastOverlay = overlayRenders[overlayRenders.length - 1];
            if (!lastOverlay) {
              throw new Error("Expected an overlay to validate");
            }
            const framesAfterCut = lastOverlay.halfDuration + lastOverlay.overlayOffset;
            if (framesAfterCut > timelineDurationInFrames) {
              throw new TypeError(`A <TransitionSeries.Overlay /> extends beyond the next sequence. The overlay needs ${framesAfterCut} frames after the cut, but the next sequence is only ${timelineDurationInFrames} frames long.`);
            }
          }
          const renderSequenceAndRest = (sequence) => {
            return /* @__PURE__ */ jsxs(Fragment, {
              children: [
                sequence,
                renderNext({
                  transitionOffsets: resolvedTransitionOffsets,
                  startFrame: resolvedStartFrame,
                  sequenceDurations: nextSequenceDurations,
                  pendingOverlayValidation: resolvedPendingOverlayValidation
                })
              ]
            });
          };
          const nextProgress = next ? next.props.timing.getProgress({
            frame: frame - actualStartFrame - timelineDurationInFrames + next.props.timing.getDurationInFrames({ fps }),
            fps
          }) : null;
          const prevProgress = prev ? prev.props.timing.getProgress({
            frame: frame - actualStartFrame,
            fps
          }) : null;
          if (next && timelineDurationInFrames < next.props.timing.getDurationInFrames({ fps })) {
            throw new Error(`The duration of a <TransitionSeries.Sequence /> must not be shorter than the duration of the next <TransitionSeries.Transition />. The transition is ${next.props.timing.getDurationInFrames({ fps })} frames long, but the sequence is only ${timelineDurationInFrames} frames long (${debugInfo})`);
          }
          if (prev && timelineDurationInFrames < prev.props.timing.getDurationInFrames({ fps })) {
            throw new Error(`The duration of a <TransitionSeries.Sequence /> must not be shorter than the duration of the previous <TransitionSeries.Transition />. The transition is ${prev.props.timing.getDurationInFrames({ fps })} frames long, but the sequence is only ${timelineDurationInFrames} frames long (${debugInfo})`);
          }
          if (next && prev && nextProgress !== null && prevProgress !== null) {
            const nextPresentation = next.props.presentation ?? slide();
            const prevPresentation = prev.props.presentation ?? slide();
            const UppercaseNextPresentation = nextPresentation.component;
            const UppercasePrevPresentation = prevPresentation.component;
            return renderSequenceAndRest(/* @__PURE__ */ jsx3(SequenceWithoutSchema, {
              from: actualStartFrame,
              durationInFrames: durationInFramesProp,
              ...propsForSequence,
              name: passedProps.name || "<TS.Sequence>",
              _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
              controls: controls ?? undefined,
              children: /* @__PURE__ */ jsx3(UppercaseNextPresentation, {
                passedProps: nextPresentation.props ?? {},
                presentationDirection: "exiting",
                presentationProgress: nextProgress,
                presentationDurationInFrames: next.props.timing.getDurationInFrames({ fps }),
                onElementImage: () => {
                  throw new Error("Should not call when exiting");
                },
                onUnmount: () => {
                  throw new Error("Should not call when exiting");
                },
                bothEnteringAndExiting: true,
                children: /* @__PURE__ */ jsx3(WrapInExitingProgressContext, {
                  presentationProgress: nextProgress,
                  children: /* @__PURE__ */ jsx3(UppercasePrevPresentation, {
                    passedProps: prevPresentation.props ?? {},
                    presentationDirection: "entering",
                    presentationProgress: prevProgress,
                    presentationDurationInFrames: prev.props.timing.getDurationInFrames({ fps }),
                    onElementImage: (elementImage, draw) => {
                      onPrevElementImage(elementImage, nextProgress, draw, i + 1);
                      onNextElementImage(elementImage, prevProgress, draw, i - 1);
                    },
                    onUnmount: () => {
                      onPrevElementImage(null, null, null, i + 1);
                      onNextElementImage(null, null, null, i - 1);
                    },
                    bothEnteringAndExiting: true,
                    children: /* @__PURE__ */ jsx3(WrapInEnteringProgressContext, {
                      presentationProgress: prevProgress,
                      children: sequenceChildren
                    })
                  })
                })
              })
            }, i));
          }
          if (prevProgress !== null && prev) {
            const prevPresentation = prev.props.presentation ?? slide();
            const UppercasePrevPresentation = prevPresentation.component;
            return renderSequenceAndRest(/* @__PURE__ */ jsx3(SequenceWithoutSchema, {
              from: actualStartFrame,
              durationInFrames: durationInFramesProp,
              ...propsForSequence,
              name: passedProps.name || "<TS.Sequence>",
              _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
              controls: controls ?? undefined,
              children: /* @__PURE__ */ jsx3(UppercasePrevPresentation, {
                passedProps: prevPresentation.props ?? {},
                presentationDirection: "entering",
                presentationProgress: prevProgress,
                presentationDurationInFrames: prev.props.timing.getDurationInFrames({ fps }),
                onElementImage: (elementImage, draw) => onNextElementImage(elementImage, prevProgress, draw, i - 1),
                onUnmount: () => {
                  onNextElementImage(null, null, null, i - 1);
                },
                bothEnteringAndExiting: false,
                children: /* @__PURE__ */ jsx3(WrapInEnteringProgressContext, {
                  presentationProgress: prevProgress,
                  children: sequenceChildren
                })
              })
            }, i));
          }
          if (nextProgress !== null && next) {
            const nextPresentation = next.props.presentation ?? slide();
            const UppercaseNextPresentation = nextPresentation.component;
            return renderSequenceAndRest(/* @__PURE__ */ jsx3(SequenceWithoutSchema, {
              from: actualStartFrame,
              durationInFrames: durationInFramesProp,
              ...propsForSequence,
              name: passedProps.name || "<TS.Sequence>",
              _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
              controls: controls ?? undefined,
              children: /* @__PURE__ */ jsx3(UppercaseNextPresentation, {
                passedProps: nextPresentation.props ?? {},
                presentationDirection: "exiting",
                presentationProgress: nextProgress,
                presentationDurationInFrames: next.props.timing.getDurationInFrames({ fps }),
                onElementImage: (elementImage, draw) => onPrevElementImage(elementImage, nextProgress, draw, i + 1),
                onUnmount: () => {
                  onPrevElementImage(null, null, null, i + 1);
                },
                bothEnteringAndExiting: false,
                children: /* @__PURE__ */ jsx3(WrapInExitingProgressContext, {
                  presentationProgress: nextProgress,
                  children: sequenceChildren
                })
              })
            }, i));
          }
          return renderSequenceAndRest(/* @__PURE__ */ jsx3(SequenceWithoutSchema, {
            from: actualStartFrame,
            durationInFrames: durationInFramesProp,
            ...propsForSequence,
            name: passedProps.name || "<TS.Sequence>",
            _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
            controls: controls ?? undefined,
            children: sequenceChildren
          }, i));
        }
      });
    };
    return renderChildren({
      index: 0,
      transitionOffsets: 0,
      startFrame: 0,
      overlayRenders: [],
      sequenceDurations: [],
      pendingOverlayValidation: false
    });
  }, [
    flattedChildren,
    fps,
    frame,
    onPrevElementImage,
    onNextElementImage,
    overlayContainer
  ]);
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [
      childrenValue,
      hasOverlay ? /* @__PURE__ */ jsx3("div", {
        ref: setOverlayContainer,
        style: { display: "contents" }
      }) : null
    ]
  });
};
var TransitionSeriesInner = (props) => {
  const {
    children,
    name,
    layout: passedLayout,
    controls
  } = props;
  const displayName = name ?? "<TransitionSeries>";
  const layout = passedLayout ?? "absolute-fill";
  const trackProps = props.layout === "none" ? props : { ...props, layout: props.layout ?? "absolute-fill" };
  if (NoReactInternals2.ENABLE_V5_BREAKING_CHANGES && layout !== "absolute-fill") {
    throw new TypeError(`The "layout" prop of <TransitionSeries /> is not supported anymore in v5. TransitionSeries' must be absolutely positioned.`);
  }
  return /* @__PURE__ */ jsx3(TrackWithoutSchema, {
    _remotionInternalDocumentationLink: "https://www.remotion.dev/docs/transitions/transitionseries",
    ...trackProps,
    name: displayName,
    controls: controls ?? undefined,
    children: /* @__PURE__ */ jsx3(TransitionSeriesChildren, {
      children
    })
  });
};
var TransitionSeries = Interactive.withSchema({
  Component: TransitionSeriesInner,
  componentName: "<TransitionSeries>",
  componentIdentity: "dev.remotion.transitions.TransitionSeries",
  schema: transitionSeriesSchema,
  supportsEffects: false
});
TransitionSeries.Sequence = SeriesSequence;
TransitionSeries.Transition = TransitionSeriesTransition;
TransitionSeries.Overlay = SeriesOverlay;
// src/use-transition-progress.ts
import React5 from "react";
var useTransitionProgress = () => {
  const entering = React5.useContext(EnteringContext);
  const exiting = React5.useContext(ExitingContext);
  if (!entering && !exiting) {
    return {
      isInTransitionSeries: false,
      entering: 1,
      exiting: 0
    };
  }
  return {
    isInTransitionSeries: true,
    entering: entering?.enteringProgress ?? 1,
    exiting: exiting?.exitingProgress ?? 0
  };
};
// src/html-in-canvas-presentation.tsx
import { useCallback as useCallback2, useLayoutEffect, useMemo as useMemo4, useRef as useRef2, useState as useState2 } from "react";
import {
  AbsoluteFill as AbsoluteFill2,
  getHtmlInCanvasUnsupportedMessage,
  HtmlInCanvas,
  Internals as Internals2,
  useCurrentFrame as useCurrentFrame2,
  useDelayRender,
  useRemotionEnvironment
} from "@motionmox/core";
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
var transferredCanvases = new WeakMap;
var HtmlInCanvasPresentationWithSupport = ({
  children,
  onElementImage,
  onUnmount,
  presentationProgress,
  presentationDirection,
  shader,
  effects,
  effectsOutputSize,
  passedProps,
  bothEnteringAndExiting
}) => {
  const canvasRef = useRef2(null);
  const outputCanvasRef = useRef2(null);
  const canvasSubtreeStyle = useMemo4(() => {
    return {
      width: "100%",
      height: "100%",
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0
    };
  }, []);
  const outputCanvasStyle = useMemo4(() => {
    return {
      width: "100%",
      height: "100%",
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      pointerEvents: "none"
    };
  }, []);
  const captureCanvasRef = useRef2(null);
  const captureContextRef = useRef2(null);
  const [shaderCanvas] = useState2(() => new OffscreenCanvas(1, 1));
  const passedPropsRef = useRef2(passedProps);
  passedPropsRef.current = passedProps;
  const memoizedEffects = Internals2.useMemoizedEffects({
    effects: effects ?? [],
    overrideId: null,
    runtimeValues: null,
    videoConfigValues: null
  });
  const effectsRef = useRef2(memoizedEffects);
  effectsRef.current = memoizedEffects;
  const instanceRef = useRef2(null);
  const videoEnabled = Internals2.useVideoEnabled();
  const passThrough = !videoEnabled || bothEnteringAndExiting && presentationDirection === "exiting";
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let captureCanvas = transferredCanvases.get(canvas);
    if (!captureCanvas) {
      captureCanvas = canvas.transferControlToOffscreen();
      transferredCanvases.set(canvas, captureCanvas);
    }
    const captureContext = captureCanvas.getContext("2d");
    if (!captureContext) {
      throw new Error("Failed to create capture canvas context");
    }
    const instance = shader(shaderCanvas);
    instanceRef.current = instance;
    captureCanvasRef.current = captureCanvas;
    captureContextRef.current = captureContext;
    return () => {
      instance.cleanup();
      instanceRef.current = null;
      captureCanvasRef.current = null;
      captureContextRef.current = null;
    };
  }, [passThrough, shader, shaderCanvas]);
  const chainState = Internals2.useEffectChainState(effectsOutputSize);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const { isRendering } = useRemotionEnvironment();
  const frame = useCurrentFrame2();
  const renderFrame = isRendering ? frame : null;
  const draw = useCallback2(async (prevImage, nextImage, progress) => {
    const instance = instanceRef.current;
    if (!instance) {
      return;
    }
    const outputCanvas = outputCanvasRef.current;
    if (!outputCanvas) {
      throw new Error("Canvas not found");
    }
    const handle = delayRender("onPaint");
    try {
      const clearOutput = () => {
        const context = outputCanvas.getContext("2d");
        if (!context) {
          throw new Error("Failed to create output canvas context");
        }
        context.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      };
      if (!prevImage && !nextImage) {
        instance.clear();
        clearOutput();
        continueRender(handle);
        return;
      }
      const width = prevImage?.width ?? nextImage?.width ?? 0;
      const height = prevImage?.height ?? nextImage?.height ?? 0;
      if (width === 0 || height === 0) {
        instance.clear();
        clearOutput();
        continueRender(handle);
        return;
      }
      shaderCanvas.width = width;
      shaderCanvas.height = height;
      instance.draw({
        prevImage,
        nextImage,
        width,
        height,
        time: progress,
        passedProps: passedPropsRef.current
      });
      await Internals2.runEffectChain({
        state: chainState.get(width, height),
        source: shaderCanvas,
        effects: effectsRef.current ?? [],
        width,
        height,
        output: outputCanvas
      });
      continueRender(handle);
    } catch (error) {
      cancelRender(error);
    }
  }, [cancelRender, chainState, continueRender, delayRender, shaderCanvas]);
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (canvas.getAttribute("content") !== "drawable") {
      canvas.setAttribute("content", "drawable");
    }
    if (canvas.layoutSubtree !== true) {
      canvas.layoutSubtree = true;
    }
    const firstChild = canvas.firstElementChild;
    if (firstChild && !firstChild.hasAttribute("drawable")) {
      firstChild.setAttribute("drawable", "");
    }
  });
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Canvas not found");
    }
    const onPaint = () => {
      const firstChild = canvas.firstElementChild;
      const captureCanvas = captureCanvasRef.current;
      const captureContext = captureContextRef.current;
      if (!firstChild || !captureCanvas || !captureContext) {
        return;
      }
      const elementImage = canvas.captureElementImage(firstChild);
      try {
        captureContext.reset();
        captureContext.drawElementImage(elementImage, 0, 0);
      } finally {
        elementImage.close();
      }
      onElementImage(captureCanvas, draw);
    };
    canvas.addEventListener("paint", onPaint);
    return () => {
      canvas.removeEventListener("paint", onPaint);
    };
  }, [onElementImage, presentationDirection, draw, passThrough]);
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Canvas not found");
    }
    const handle = delayRender("waiting for transition paint");
    const onPainted = () => {
      continueRender(handle);
    };
    canvas.addEventListener("paint", onPainted, { once: true });
    canvas.requestPaint?.();
    return () => {
      canvas.removeEventListener("paint", onPainted);
      onPainted();
    };
  }, [
    presentationProgress,
    passThrough,
    memoizedEffects,
    chainState,
    renderFrame,
    continueRender,
    delayRender
  ]);
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    return () => {
      onUnmount();
    };
  }, [onUnmount, passThrough]);
  useLayoutEffect(() => {
    if (passThrough) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const outputCanvas = outputCanvasRef.current;
      const captureCanvas = captureCanvasRef.current;
      if (!outputCanvas || !captureCanvas) {
        return;
      }
      const width = entry.devicePixelContentBoxSize[0].inlineSize;
      const height = entry.devicePixelContentBoxSize[0].blockSize;
      captureCanvas.width = width;
      captureCanvas.height = height;
      outputCanvas.width = width;
      outputCanvas.height = height;
      canvas.requestPaint?.();
    });
    observer.observe(canvas, { box: "device-pixel-content-box" });
    return () => {
      observer.disconnect();
    };
  }, [passThrough]);
  if (passThrough) {
    return children;
  }
  return /* @__PURE__ */ jsxs2(AbsoluteFill2, {
    showInTimeline: false,
    children: [
      /* @__PURE__ */ jsx4("canvas", {
        ref: canvasRef,
        style: canvasSubtreeStyle,
        children: /* @__PURE__ */ jsx4("div", {
          style: canvasSubtreeStyle,
          children
        })
      }),
      /* @__PURE__ */ jsx4("canvas", {
        ref: outputCanvasRef,
        style: outputCanvasStyle
      })
    ]
  });
};
var HtmlInCanvasPresentation = (props) => {
  const { isRendering } = useRemotionEnvironment();
  if (!HtmlInCanvas.isSupported()) {
    if (isRendering) {
      throw new Error(getHtmlInCanvasUnsupportedMessage());
    }
    const visible = props.presentationDirection === "entering" ? props.presentationProgress >= 0.5 : props.presentationProgress < 0.5;
    return /* @__PURE__ */ jsx4(Internals2.HtmlInCanvasFallback, {
      label: "Transition is not visible",
      style: {
        position: "absolute",
        inset: 0,
        visibility: visible ? "visible" : "hidden"
      },
      children: props.children
    });
  }
  return /* @__PURE__ */ jsx4(HtmlInCanvasPresentationWithSupport, {
    ...props
  });
};
var makeHtmlInCanvasPresentation = (shader) => {
  const CompWithShader = (props) => {
    const { passedProps, ...otherProps } = props;
    const { effects, effectsOutputSize, ...restPassedProps } = props.passedProps;
    return /* @__PURE__ */ jsx4(HtmlInCanvasPresentation, {
      shader,
      passedProps: restPassedProps,
      effects: effects ?? null,
      effectsOutputSize: effectsOutputSize ?? null,
      ...otherProps
    });
  };
  return (props) => {
    return {
      component: CompWithShader,
      props
    };
  };
};
// src/presentations/upload-element-image.ts
var uploadElementImage = (gl, elementImage) => {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elementImage);
};

// src/presentations/blur-slide.tsx
var DEFAULT_DIRECTION = "from-left";
var DEFAULT_BLUR = 0.5;
var VALID_DIRECTIONS = [
  "from-left",
  "from-right",
  "from-top",
  "from-bottom"
];
var VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
var SAMPLES = 32;
var SLIDE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_progress;
uniform vec2 u_direction;
uniform float u_blur_length;

in vec2 v_uv;
out vec4 outColor;

const int SAMPLES = ${SAMPLES};

void main() {
	// Both scenes travel together; the exiting scene wraps around the edges
	// while the entering scene takes over through a crossfade in the middle.
	vec2 slidUv = v_uv - u_direction * u_progress;
	float mixFactor = smoothstep(0.3, 0.7, u_progress);

	vec4 color = vec4(0.0);
	for (int i = 0; i < SAMPLES; i++) {
		float t = (float(i) / float(SAMPLES - 1) - 0.5) * u_blur_length;
		vec2 uv = slidUv + u_direction * t;
		color += mix(texture(u_prev, uv), texture(u_next, uv), mixFactor);
	}

	outColor = color / float(SAMPLES);
}`;
var BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_direction;
uniform float u_blur_length;

in vec2 v_uv;
out vec4 outColor;

const int SAMPLES = ${SAMPLES};

void main() {
	vec4 color = vec4(0.0);
	for (int i = 0; i < SAMPLES; i++) {
		float t = ((float(i) + 0.5) / float(SAMPLES) - 0.5) * u_blur_length;
		vec2 uv = v_uv + u_direction * t;
		// The framebuffer texture is stored bottom-up, so flip Y when sampling it.
		color += texture(u_source, vec2(uv.x, 1.0 - uv.y));
	}

	outColor = color / float(SAMPLES);
}`;
var compileShader = (gl, source, type) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${log}`);
  }
  return shader;
};
var createProgram = (gl, fragmentShader) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fragmentShader, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${log}`);
  }
  return program;
};
var createTexture = (gl) => {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
};
var getDirectionVector = (direction) => {
  switch (direction) {
    case "from-left":
      return [1, 0];
    case "from-right":
      return [-1, 0];
    case "from-top":
      return [0, 1];
    case "from-bottom":
      return [0, -1];
    default:
      throw new Error(`Invalid direction: ${direction}`);
  }
};
var validateProps = (props) => {
  const direction = props.direction ?? DEFAULT_DIRECTION;
  const blur = props.blur ?? DEFAULT_BLUR;
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw new TypeError(`direction passed to blurSlide() must be one of ${VALID_DIRECTIONS.map((d) => `"${d}"`).join(", ")}, received ${JSON.stringify(direction)}`);
  }
  if (typeof blur !== "number" || !Number.isFinite(blur)) {
    throw new TypeError(`blur passed to blurSlide() must be a finite number, received ${blur}`);
  }
  if (blur < 0) {
    throw new TypeError(`blur passed to blurSlide() must be greater than or equal to 0, received ${blur}`);
  }
};
var blurSlideShader = (canvas) => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true });
  if (!gl) {
    throw new Error("Failed to create WebGL2 context");
  }
  const slideProgram = createProgram(gl, SLIDE_FRAGMENT_SHADER);
  const blurProgram = createProgram(gl, BLUR_FRAGMENT_SHADER);
  const prevTex = createTexture(gl);
  const nextTex = createTexture(gl);
  const intermediateTex = createTexture(gl);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    throw new Error("Failed to create framebuffer");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, intermediateTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let intermediateWidth = 1;
  let intermediateHeight = 1;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(slideProgram, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uPrev = gl.getUniformLocation(slideProgram, "u_prev");
  const uNext = gl.getUniformLocation(slideProgram, "u_next");
  const uProgress = gl.getUniformLocation(slideProgram, "u_progress");
  const uSlideDirection = gl.getUniformLocation(slideProgram, "u_direction");
  const uSlideBlurLength = gl.getUniformLocation(slideProgram, "u_blur_length");
  const uSource = gl.getUniformLocation(blurProgram, "u_source");
  const uBlurDirection = gl.getUniformLocation(blurProgram, "u_direction");
  const uBlurBlurLength = gl.getUniformLocation(blurProgram, "u_blur_length");
  const cleanup = () => {
    gl.deleteProgram(slideProgram);
    gl.deleteProgram(blurProgram);
    gl.deleteTexture(prevTex);
    gl.deleteTexture(nextTex);
    gl.deleteTexture(intermediateTex);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
  };
  const clear = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const draw = ({
    prevImage,
    nextImage,
    width,
    height,
    time,
    passedProps
  }) => {
    const { direction = DEFAULT_DIRECTION, blur = DEFAULT_BLUR } = passedProps;
    if (!prevImage && !nextImage) {
      return;
    }
    if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
      return;
    }
    if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
      return;
    }
    const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
    const p = 1 - effectiveTime;
    const progress = p * p * p * (p * (p * 6 - 15) + 10);
    const blurLength = blur * 2 * Math.min(progress, 1 - progress);
    const coarseTapSpacing = blurLength / (SAMPLES - 1);
    const [dirX, dirY] = getDirectionVector(direction);
    gl.bindVertexArray(vao);
    if (intermediateWidth !== width || intermediateHeight !== height) {
      gl.bindTexture(gl.TEXTURE_2D, intermediateTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      intermediateWidth = width;
      intermediateHeight = height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(slideProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevImage) {
      uploadElementImage(gl, prevImage);
    }
    gl.uniform1i(uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nextTex);
    if (nextImage) {
      uploadElementImage(gl, nextImage);
    }
    gl.uniform1i(uNext, 1);
    gl.uniform1f(uProgress, progress);
    gl.uniform2f(uSlideDirection, dirX, dirY);
    gl.uniform1f(uSlideBlurLength, blurLength);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, intermediateTex);
    gl.uniform1i(uSource, 0);
    gl.uniform2f(uBlurDirection, dirX, dirY);
    gl.uniform1f(uBlurBlurLength, coarseTapSpacing);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    clear,
    cleanup,
    draw
  };
};
var makeBlurSlide = makeHtmlInCanvasPresentation(blurSlideShader);
var blurSlide = (props = {}) => {
  validateProps(props);
  return makeBlurSlide(props);
};
// src/presentations/cross-zoom.tsx
var DEFAULT_STRENGTH = 0.4;
var VERTEX_SHADER2 = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
var FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_time;
uniform float u_strength;

in vec2 v_uv;
out vec4 outColor;

const float PI = 3.141592653589793;

float linearEase(float begin, float change, float duration, float time) {
	return change * time / duration + begin;
}

float exponentialEaseInOut(float begin, float change, float duration, float time) {
	if (time == 0.0) {
		return begin;
	}

	if (time == duration) {
		return begin + change;
	}

	float t = time / (duration / 2.0);
	if (t < 1.0) {
		return change / 2.0 * pow(2.0, 10.0 * (t - 1.0)) + begin;
	}

	return change / 2.0 * (-pow(2.0, -10.0 * (t - 1.0)) + 2.0) + begin;
}

float sinusoidalEaseInOut(float begin, float change, float duration, float time) {
	return -change / 2.0 * (cos(PI * time / duration) - 1.0) + begin;
}

float random(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 crossFade(vec2 uv, float dissolve) {
	return mix(texture(u_prev, uv), texture(u_next, uv), dissolve);
}

vec4 transition(vec2 uv, float progress) {
	vec2 center = vec2(linearEase(0.25, 0.5, 1.0, progress), 0.5);
	float dissolve = exponentialEaseInOut(0.0, 1.0, 1.0, progress);
	float strength = sinusoidalEaseInOut(0.0, u_strength, 0.5, progress);

	vec4 color = vec4(0.0);
	float total = 0.0;
	vec2 toCenter = center - uv;
	float offset = random(uv);

	for (int i = 0; i <= 40; i++) {
		float percent = (float(i) + offset) / 40.0;
		float weight = 4.0 * (percent - percent * percent);
		color += crossFade(uv + toCenter * percent * strength, dissolve) * weight;
		total += weight;
	}

	return color / total;
}

void main() {
	float progress = 1.0 - u_time;
	outColor = transition(v_uv, progress);
}`;
var compileShader2 = (gl, source, type) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${log}`);
  }
  return shader;
};
var createProgram2 = (gl) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader2(gl, VERTEX_SHADER2, gl.VERTEX_SHADER);
  const fs = compileShader2(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${log}`);
  }
  return program;
};
var createTexture2 = (gl) => {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
};
var crossZoomShader = (canvas) => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true });
  if (!gl) {
    throw new Error("Failed to create WebGL2 context");
  }
  const program = createProgram2(gl);
  const prevTex = createTexture2(gl);
  const nextTex = createTexture2(gl);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(program, "u_time");
  const uPrev = gl.getUniformLocation(program, "u_prev");
  const uNext = gl.getUniformLocation(program, "u_next");
  const uStrength = gl.getUniformLocation(program, "u_strength");
  const cleanup = () => {
    gl.deleteProgram(program);
    gl.deleteTexture(prevTex);
    gl.deleteTexture(nextTex);
  };
  const clear = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const draw = ({
    prevImage,
    nextImage,
    width,
    height,
    time,
    passedProps
  }) => {
    const { strength = DEFAULT_STRENGTH } = passedProps;
    if (!prevImage && !nextImage) {
      return;
    }
    if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
      return;
    }
    if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
      return;
    }
    const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevImage) {
      uploadElementImage(gl, prevImage);
    }
    gl.uniform1i(uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nextTex);
    if (nextImage) {
      uploadElementImage(gl, nextImage);
    }
    gl.uniform1i(uNext, 1);
    gl.uniform1f(uTime, effectiveTime);
    gl.uniform1f(uStrength, strength);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    clear,
    cleanup,
    draw
  };
};
var crossZoom = makeHtmlInCanvasPresentation(crossZoomShader);
// src/presentations/dreamy-zoom.tsx
var DEFAULT_ROTATION = 6;
var DEFAULT_SCALE = 1.2;
var VERTEX_SHADER3 = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
var FRAGMENT_SHADER2 = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_time;
uniform float u_rotation;
uniform float u_scale;
uniform float u_ratio;

in vec2 v_uv;
out vec4 outColor;

const float DEG2RAD = 0.03926990816987241548078304229099;

vec4 transition(vec2 uv, float progress) {
	float phase = progress < 0.5 ? progress * 2.0 : (progress - 0.5) * 2.0;
	float angleOffset = progress < 0.5 ? mix(0.0, u_rotation * DEG2RAD, phase) : mix(-u_rotation * DEG2RAD, 0.0, phase);
	float newScale = progress < 0.5 ? mix(1.0, u_scale, phase) : mix(u_scale, 1.0, phase);

	vec2 center = vec2(0.0, 0.0);
	vec2 p = (uv.xy - vec2(0.5, 0.5)) / newScale * vec2(u_ratio, 1.0);
	float angle = atan(p.y, p.x) + angleOffset;
	float dist = distance(center, p);

	p.x = cos(angle) * dist / u_ratio + 0.5;
	p.y = sin(angle) * dist + 0.5;

	vec4 c = progress < 0.5 ? texture(u_prev, p) : texture(u_next, p);
	return c + (progress < 0.5 ? mix(0.0, 1.0, phase) : mix(1.0, 0.0, phase));
}

void main() {
	float progress = 1.0 - u_time;
	outColor = transition(v_uv, progress);
}`;
var compileShader3 = (gl, source, type) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${log}`);
  }
  return shader;
};
var createProgram3 = (gl) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader3(gl, VERTEX_SHADER3, gl.VERTEX_SHADER);
  const fs = compileShader3(gl, FRAGMENT_SHADER2, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${log}`);
  }
  return program;
};
var createTexture3 = (gl) => {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
};
var dreamyZoomShader = (canvas) => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true });
  if (!gl) {
    throw new Error("Failed to create WebGL2 context");
  }
  const program = createProgram3(gl);
  const prevTex = createTexture3(gl);
  const nextTex = createTexture3(gl);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(program, "u_time");
  const uPrev = gl.getUniformLocation(program, "u_prev");
  const uNext = gl.getUniformLocation(program, "u_next");
  const uRotation = gl.getUniformLocation(program, "u_rotation");
  const uScale = gl.getUniformLocation(program, "u_scale");
  const uRatio = gl.getUniformLocation(program, "u_ratio");
  const cleanup = () => {
    gl.deleteProgram(program);
    gl.deleteTexture(prevTex);
    gl.deleteTexture(nextTex);
  };
  const clear = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const draw = ({
    prevImage,
    nextImage,
    width,
    height,
    time,
    passedProps
  }) => {
    const { rotation = DEFAULT_ROTATION, scale = DEFAULT_SCALE } = passedProps;
    if (!prevImage && !nextImage) {
      return;
    }
    if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
      return;
    }
    if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
      return;
    }
    const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevImage) {
      uploadElementImage(gl, prevImage);
    }
    gl.uniform1i(uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nextTex);
    if (nextImage) {
      uploadElementImage(gl, nextImage);
    }
    gl.uniform1i(uNext, 1);
    gl.uniform1f(uTime, effectiveTime);
    gl.uniform1f(uRotation, rotation);
    gl.uniform1f(uScale, scale);
    gl.uniform1f(uRatio, width / height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    clear,
    cleanup,
    draw
  };
};
var dreamyZoom = makeHtmlInCanvasPresentation(dreamyZoomShader);
// src/presentations/film-burn.tsx
var DEFAULT_SEED = 2.31;
var VERTEX_SHADER4 = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
var FRAGMENT_SHADER3 = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_time;
uniform float u_seed;

in vec2 v_uv;
out vec4 outColor;

#define PI 3.14159265358979323
#define CLAMPS(x) clamp(x, 0.0, 1.0)
#define REPEATS 50.0

float sigmoid(float x, float a) {
	float b = pow(x * 2.0, a) / 2.0;
	if (x > 0.5) {
		b = 1.0 - pow(2.0 - (x * 2.0), a) / 2.0;
	}
	return b;
}

float rand(float co) {
	return fract(sin((co * 24.9898) + u_seed) * 43758.5453);
}

float rand(vec2 co) {
	return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

float apow(float a, float b) {
	return pow(abs(a), b) * sign(b);
}

vec3 pow3(vec3 a, vec3 b) {
	return vec3(apow(a.r, b.r), apow(a.g, b.g), apow(a.b, b.b));
}

float smoothMix(float a, float b, float c) {
	return mix(a, b, sigmoid(c, 2.0));
}

float random(vec2 co, float shft) {
	co += 10.0;
	return smoothMix(
		fract(
			sin(
				dot(
					co.xy,
					vec2(12.9898 + (floor(shft) * 0.5), 78.233 + u_seed)
				)
			) * 43758.5453
		),
		fract(
			sin(
				dot(
					co.xy,
					vec2(12.9898 + (floor(shft + 1.0) * 0.5), 78.233 + u_seed)
				)
			) * 43758.5453
		),
		fract(shft)
	);
}

float smoothRandom(vec2 co, float shft) {
	return smoothMix(
		smoothMix(
			random(floor(co), shft),
			random(floor(co + vec2(1.0, 0.0)), shft),
			fract(co.x)
		),
		smoothMix(
			random(floor(co + vec2(0.0, 1.0)), shft),
			random(floor(co + vec2(1.0, 1.0)), shft),
			fract(co.x)
		),
		fract(co.y)
	);
}

vec4 sampleTexture(vec2 p, float progress) {
	return mix(texture(u_prev, p), texture(u_next, p), sigmoid(progress, 10.0));
}

vec4 transition(vec2 p, float progress) {
	vec3 f = vec3(0.0);
	for (float i = 0.0; i < 13.0; i++) {
		f += sin(((p.x * rand(i) * 6.0) + (progress * 8.0)) + rand(i + 1.43)) *
			sin(
				((p.y * rand(i + 4.4) * 6.0) + (progress * 6.0)) +
					rand(i + 2.4)
			);
		f += 1.0 - CLAMPS(
			length(
				p -
					vec2(
						smoothRandom(vec2(progress * 1.3), i + 1.0),
						smoothRandom(vec2(progress * 0.5), i + 6.25)
					)
			) * mix(20.0, 70.0, rand(i))
		);
	}

	f += 4.0;
	f /= 11.0;
	f = pow3(
		f * vec3(1.0, 0.7, 0.6),
		vec3(1.0, 2.0 - sin(progress * PI), 1.3)
	);
	f *= sin(progress * PI);

	p -= 0.5;
	p *= 1.0 + (smoothRandom(vec2(progress * 5.0), 6.3) * sin(progress * PI) * 0.05);
	p += 0.5;

	vec4 blurredImage = vec4(0.0);
	float blurAmount = sin(progress * PI) * 0.03;
	for (float i = 0.0; i < REPEATS; i++) {
		vec2 q = vec2(
			cos(degrees((i / REPEATS) * 360.0)),
			sin(degrees((i / REPEATS) * 360.0))
		) * (rand(vec2(i, p.x + p.y)) + blurAmount);
		vec2 uv2 = p + (q * blurAmount);
		blurredImage += sampleTexture(uv2, progress);
	}

	blurredImage /= REPEATS;
	return blurredImage + vec4(f, 0.0);
}

void main() {
	float progress = 1.0 - u_time;
	outColor = transition(v_uv, progress);
}`;
var compileShader4 = (gl, source, type) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${log}`);
  }
  return shader;
};
var createProgram4 = (gl) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader4(gl, VERTEX_SHADER4, gl.VERTEX_SHADER);
  const fs = compileShader4(gl, FRAGMENT_SHADER3, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${log}`);
  }
  return program;
};
var createTexture4 = (gl) => {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
};
var filmBurnShader = (canvas) => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true });
  if (!gl) {
    throw new Error("Failed to create WebGL2 context");
  }
  const program = createProgram4(gl);
  const prevTex = createTexture4(gl);
  const nextTex = createTexture4(gl);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(program, "u_time");
  const uPrev = gl.getUniformLocation(program, "u_prev");
  const uNext = gl.getUniformLocation(program, "u_next");
  const uSeed = gl.getUniformLocation(program, "u_seed");
  const cleanup = () => {
    gl.deleteProgram(program);
    gl.deleteTexture(prevTex);
    gl.deleteTexture(nextTex);
  };
  const clear = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const draw = ({
    prevImage,
    nextImage,
    width,
    height,
    time,
    passedProps
  }) => {
    const { seed = DEFAULT_SEED } = passedProps;
    if (!prevImage && !nextImage) {
      return;
    }
    if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
      return;
    }
    if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
      return;
    }
    const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevImage) {
      uploadElementImage(gl, prevImage);
    }
    gl.uniform1i(uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nextTex);
    if (nextImage) {
      uploadElementImage(gl, nextImage);
    }
    gl.uniform1i(uNext, 1);
    gl.uniform1f(uTime, effectiveTime);
    gl.uniform1f(uSeed, seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    clear,
    cleanup,
    draw
  };
};
var filmBurn = makeHtmlInCanvasPresentation(filmBurnShader);
// src/presentations/linear-blur.tsx
var VERTEX_SHADER5 = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
	v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
var FRAGMENT_SHADER4 = `#version 300 es
precision highp float;

uniform sampler2D u_prev;
uniform sampler2D u_next;
uniform float u_time;
uniform float u_intensity;

in vec2 v_uv;
out vec4 outColor;

const int PASSES = 20;

vec4 transition(vec2 uv, float progress) {
	vec4 c1 = vec4(0.0);
	vec4 c2 = vec4(0.0);

	float disp = u_intensity * (0.5 - distance(0.5, progress));
	for (int xi = 0; xi < PASSES; xi++) {
		float x = float(xi) / float(PASSES) - 0.5;
		for (int yi = 0; yi < PASSES; yi++) {
			float y = float(yi) / float(PASSES) - 0.5;
			vec2 v = vec2(x, y);
			c1 += texture(u_prev, uv + disp * v);
			c2 += texture(u_next, uv + disp * v);
		}
	}

	c1 /= float(PASSES * PASSES);
	c2 /= float(PASSES * PASSES);
	return mix(c1, c2, progress);
}

void main() {
	float progress = 1.0 - u_time;
	outColor = transition(v_uv, progress);
}`;
var compileShader5 = (gl, source, type) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${log}`);
  }
  return shader;
};
var createProgram5 = (gl) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader5(gl, VERTEX_SHADER5, gl.VERTEX_SHADER);
  const fs = compileShader5(gl, FRAGMENT_SHADER4, gl.FRAGMENT_SHADER);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${log}`);
  }
  return program;
};
var createTexture5 = (gl) => {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  return tex;
};
var linearBlurShader = (canvas) => {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true });
  if (!gl) {
    throw new Error("Failed to create WebGL2 context");
  }
  const program = createProgram5(gl);
  const prevTex = createTexture5(gl);
  const nextTex = createTexture5(gl);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(program, "u_time");
  const uPrev = gl.getUniformLocation(program, "u_prev");
  const uNext = gl.getUniformLocation(program, "u_next");
  const uIntensity = gl.getUniformLocation(program, "u_intensity");
  const cleanup = () => {
    gl.deleteProgram(program);
    gl.deleteTexture(prevTex);
    gl.deleteTexture(nextTex);
  };
  const clear = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const draw = ({
    prevImage,
    nextImage,
    width,
    height,
    time,
    passedProps
  }) => {
    const { intensity = 0.1 } = passedProps;
    if (!prevImage && !nextImage) {
      return;
    }
    if (prevImage && (prevImage.width === 0 || prevImage.height === 0)) {
      return;
    }
    if (nextImage && (nextImage.width === 0 || nextImage.height === 0)) {
      return;
    }
    const effectiveTime = !prevImage ? 0 : !nextImage ? 1 : time;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    if (prevImage) {
      uploadElementImage(gl, prevImage);
    }
    gl.uniform1i(uPrev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nextTex);
    if (nextImage) {
      uploadElementImage(gl, nextImage);
    }
    gl.uniform1i(uNext, 1);
    gl.uniform1f(uTime, effectiveTime);
    gl.uniform1f(uIntensity, intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    clear,
    cleanup,
    draw
  };
};
var linearBlur = makeHtmlInCanvasPresentation(linearBlurShader);
// src/presentations/push-cut.tsx
import { useMemo as useMemo5 } from "react";
import { AbsoluteFill as AbsoluteFill3, Easing, interpolate as interpolate2 } from "@motionmox/core";
import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
var clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp"
};
var validateFiniteNumber = (name, value) => {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} passed to pushCut() must be finite, received ${value}`);
  }
};
var validateProps2 = (props) => {
  const cutProgress = props.cutProgress ?? 5 / 11;
  const outgoingScale = props.outgoingScale ?? 1.04;
  const incomingStartScale = props.incomingStartScale ?? 1.04;
  const incomingEndScale = props.incomingEndScale ?? 1.07;
  const flashOpacity = props.flashOpacity ?? 0.2;
  const flashFrames = props.flashFrames ?? 2;
  validateFiniteNumber("cutProgress", cutProgress);
  if (cutProgress <= 0 || cutProgress >= 1) {
    throw new TypeError(`cutProgress passed to pushCut() must be greater than 0 and less than 1, received ${cutProgress}`);
  }
  for (const [name, value] of [
    ["outgoingScale", outgoingScale],
    ["incomingStartScale", incomingStartScale],
    ["incomingEndScale", incomingEndScale]
  ]) {
    validateFiniteNumber(name, value);
    if (value <= 0) {
      throw new TypeError(`${name} passed to pushCut() must be greater than 0, received ${value}`);
    }
  }
  validateFiniteNumber("flashOpacity", flashOpacity);
  if (flashOpacity < 0 || flashOpacity > 1) {
    throw new TypeError(`flashOpacity passed to pushCut() must be between 0 and 1, received ${flashOpacity}`);
  }
  validateFiniteNumber("flashFrames", flashFrames);
  if (flashFrames < 0) {
    throw new TypeError(`flashFrames passed to pushCut() must be greater than or equal to 0, received ${flashFrames}`);
  }
};
var PushCutPresentation = ({
  children,
  presentationDirection,
  presentationDurationInFrames,
  presentationProgress,
  passedProps
}) => {
  const {
    cutProgress = 5 / 11,
    outgoingScale = 1.04,
    incomingStartScale = 1.04,
    incomingEndScale = 1.07,
    transformOrigin = "50% 50%",
    flashColor = "#f5f2ed",
    flashOpacity: peakFlashOpacity = 0.2,
    flashFrames = 2,
    outerEnterStyle,
    outerExitStyle,
    innerEnterStyle,
    innerExitStyle
  } = passedProps;
  const isEntering = presentationDirection === "entering";
  const outgoingProgress = interpolate2(presentationProgress, [0, cutProgress], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad)
  });
  const incomingProgress = interpolate2(presentationProgress, [cutProgress, 1], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad)
  });
  const scale = isEntering ? interpolate2(incomingProgress, [0, 1], [incomingStartScale, incomingEndScale]) : interpolate2(outgoingProgress, [0, 1], [1, outgoingScale]);
  const oneFrame = 1 / Math.max(1, presentationDurationInFrames);
  const flashTail = flashFrames / Math.max(1, presentationDurationInFrames);
  const flashOpacity = isEntering ? interpolate2(presentationProgress, [cutProgress, cutProgress + flashTail], [peakFlashOpacity, 0], clamp) : interpolate2(presentationProgress, [cutProgress - oneFrame, cutProgress], [0, peakFlashOpacity], clamp);
  const outerStyle = useMemo5(() => {
    return {
      opacity: isEntering && presentationProgress < cutProgress ? 0 : 1,
      overflow: "hidden",
      ...isEntering ? outerEnterStyle : outerExitStyle
    };
  }, [
    cutProgress,
    isEntering,
    outerEnterStyle,
    outerExitStyle,
    presentationProgress
  ]);
  const innerStyle = useMemo5(() => {
    return {
      transform: `scale(${scale})`,
      transformOrigin,
      willChange: "transform",
      ...isEntering ? innerEnterStyle : innerExitStyle
    };
  }, [innerEnterStyle, innerExitStyle, isEntering, scale, transformOrigin]);
  return /* @__PURE__ */ jsxs3(AbsoluteFill3, {
    showInTimeline: false,
    style: outerStyle,
    children: [
      /* @__PURE__ */ jsx5(AbsoluteFill3, {
        showInTimeline: false,
        style: innerStyle,
        children
      }),
      flashOpacity > 0 ? /* @__PURE__ */ jsx5(AbsoluteFill3, {
        showInTimeline: false,
        style: {
          backgroundColor: flashColor,
          opacity: flashOpacity,
          pointerEvents: "none"
        }
      }) : null
    ]
  });
};
var pushCut = (props) => {
  const passedProps = props ?? {};
  validateProps2(passedProps);
  return {
    component: PushCutPresentation,
    props: passedProps
  };
};
export {
  TransitionSeries,
  blurSlide,
  crossZoom,
  dreamyZoom,
  filmBurn,
  linearBlur,
  linearTiming,
  makeHtmlInCanvasPresentation,
  pushCut,
  springTiming,
  useTransitionProgress
};
