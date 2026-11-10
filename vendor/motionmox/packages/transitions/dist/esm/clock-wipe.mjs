// src/presentations/clock-wipe.tsx
import { translatePath } from "@motionmox/paths";
import { makePie } from "@motionmox/shapes";
import { useMemo } from "react";
import { AbsoluteFill } from "@motionmox/core";
import { jsx } from "react/jsx-runtime";
var ClockWipePresentation = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const finishedRadius = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
  const { path } = makePie({
    radius: finishedRadius,
    progress: presentationProgress
  });
  const translatedPath = translatePath(path, -(finishedRadius * 2 - passedProps.width) / 2, -(finishedRadius * 2 - passedProps.height) / 2);
  const style = useMemo(() => {
    return {
      width: "100%",
      height: "100%",
      clipPath: presentationDirection === "exiting" ? undefined : `path("${translatedPath}")`,
      ...presentationDirection === "entering" ? passedProps.innerEnterStyle : passedProps.innerExitStyle
    };
  }, [
    translatedPath,
    passedProps.innerEnterStyle,
    passedProps.innerExitStyle,
    presentationDirection
  ]);
  const outerStyle = useMemo(() => {
    return presentationDirection === "entering" ? passedProps.outerEnterStyle : passedProps.outerExitStyle;
  }, [
    passedProps.outerEnterStyle,
    passedProps.outerExitStyle,
    presentationDirection
  ]);
  return /* @__PURE__ */ jsx(AbsoluteFill, {
    showInTimeline: false,
    style: outerStyle,
    children: /* @__PURE__ */ jsx(AbsoluteFill, {
      showInTimeline: false,
      style,
      children
    })
  });
};
var clockWipe = (props) => {
  return { component: ClockWipePresentation, props: props ?? {} };
};
export {
  clockWipe
};
