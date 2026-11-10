// src/presentations/iris.tsx
import { translatePath } from "@motionmox/paths";
import { makeCircle } from "@motionmox/shapes";
import { useMemo } from "react";
import { AbsoluteFill } from "@motionmox/core";
import { jsx } from "react/jsx-runtime";
var IrisPresentation = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const maxRadius = Math.sqrt(passedProps.width ** 2 + passedProps.height ** 2) / 2;
  const minRadius = 0;
  const currentRadius = presentationDirection === "entering" ? minRadius + (maxRadius - minRadius) * presentationProgress : maxRadius - (maxRadius - minRadius) * presentationProgress;
  const { path } = makeCircle({
    radius: currentRadius
  });
  const translatedPath = translatePath(path, passedProps.width / 2 - currentRadius, passedProps.height / 2 - currentRadius);
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
var iris = (props) => {
  return { component: IrisPresentation, props: props ?? {} };
};
export {
  iris
};
