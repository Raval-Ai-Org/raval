// src/components/arrow.tsx
import { Interactive as Interactive2 } from "@motionmox/core";

// src/utils/make-arrow.ts
import { serializeInstructions } from "@motionmox/paths";
var unitDir = (from, to) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  return len === 0 ? [0, 0] : [dx / len, dy / len];
};
var buildArrowPath = (points, roundedIndices, cornerRadius) => {
  const n = points.length;
  if (cornerRadius === 0) {
    return [
      { type: "M", x: points[0][0], y: points[0][1] },
      ...points.slice(1).map(([x, y]) => ({ type: "L", x, y })),
      { type: "Z" }
    ];
  }
  const d0 = unitDir(points[0], points[1]);
  const startX = points[0][0] + d0[0] * cornerRadius;
  const startY = points[0][1] + d0[1] * cornerRadius;
  const instrs = [{ type: "M", x: startX, y: startY }];
  for (let i = 1;i < n; i++) {
    const curr = points[i];
    if (roundedIndices.has(i)) {
      const prev = points[i - 1];
      const next = points[(i + 1) % n];
      const dIn = unitDir(prev, curr);
      const dOut = unitDir(curr, next);
      instrs.push({
        type: "L",
        x: curr[0] - dIn[0] * cornerRadius,
        y: curr[1] - dIn[1] * cornerRadius
      }, {
        type: "C",
        cp1x: curr[0],
        cp1y: curr[1],
        cp2x: curr[0],
        cp2y: curr[1],
        x: curr[0] + dOut[0] * cornerRadius,
        y: curr[1] + dOut[1] * cornerRadius
      });
    } else {
      instrs.push({ type: "L", x: curr[0], y: curr[1] });
    }
  }
  const dIn0 = unitDir(points[n - 1], points[0]);
  instrs.push({
    type: "L",
    x: points[0][0] - dIn0[0] * cornerRadius,
    y: points[0][1] - dIn0[1] * cornerRadius
  }, {
    type: "C",
    cp1x: points[0][0],
    cp1y: points[0][1],
    cp2x: points[0][0],
    cp2y: points[0][1],
    x: startX,
    y: startY
  }, { type: "Z" });
  return instrs;
};
var makeArrow = ({
  length = 300,
  headWidth = 185,
  headLength = 120,
  shaftWidth = 80,
  direction = "right",
  cornerRadius = 0
}) => {
  if (length <= 0 || headWidth <= 0 || headLength <= 0 || shaftWidth <= 0) {
    throw new Error('All dimension parameters ("length", "headWidth", "headLength", "shaftWidth") must be positive numbers');
  }
  if (headWidth < shaftWidth) {
    throw new Error(`"headWidth" must be greater than or equal to "shaftWidth", got headWidth=${headWidth} and shaftWidth=${shaftWidth}`);
  }
  if (headLength > length) {
    throw new Error(`"headLength" must be less than or equal to "length", got headLength=${headLength} and length=${length}`);
  }
  const shaftTop = (headWidth - shaftWidth) / 2;
  const shaftBottom = shaftTop + shaftWidth;
  const shaftEnd = length - headLength;
  const rightPoints = [
    [0, shaftTop],
    [shaftEnd, shaftTop],
    [shaftEnd, 0],
    [length, headWidth / 2],
    [shaftEnd, headWidth],
    [shaftEnd, shaftBottom],
    [0, shaftBottom]
  ];
  let points;
  let width;
  let height;
  if (direction === "right") {
    points = rightPoints;
    width = length;
    height = headWidth;
  } else if (direction === "left") {
    points = rightPoints.map(([x, y]) => [length - x, y]);
    width = length;
    height = headWidth;
  } else if (direction === "down") {
    points = [
      [shaftTop, 0],
      [shaftBottom, 0],
      [shaftBottom, shaftEnd],
      [headWidth, shaftEnd],
      [headWidth / 2, length],
      [0, shaftEnd],
      [shaftTop, shaftEnd]
    ];
    width = headWidth;
    height = length;
  } else {
    points = [
      [shaftTop, length],
      [shaftBottom, length],
      [shaftBottom, headLength],
      [headWidth, headLength],
      [headWidth / 2, 0],
      [0, headLength],
      [shaftTop, headLength]
    ];
    width = headWidth;
    height = length;
  }
  const roundedIndices = direction === "right" || direction === "left" ? new Set([0, 2, 3, 4, 6]) : new Set([0, 1, 3, 4, 5]);
  const instructions = buildArrowPath(points, roundedIndices, cornerRadius);
  const path = serializeInstructions(instructions);
  return {
    path,
    instructions,
    width,
    height,
    transformOrigin: `${width / 2} ${height / 2}`
  };
};

// src/components/render-svg.tsx
import React, { useMemo } from "react";
import { version } from "react-dom";
import {
  HtmlInCanvas,
  Freeze,
  Sequence,
  Internals
} from "@motionmox/core";

// src/utils/does-react-support-canary.ts
var doesReactSupportTransformOriginProperty = (version) => {
  if (version.includes("canary") || version.includes("experimental")) {
    const last8Chars = parseInt(version.slice(-8), 10);
    return last8Chars > 20230209;
  }
  const [major] = version.split(".").map(Number);
  return major > 18;
};

// src/components/render-svg.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var HtmlInCanvasWithPrivateProps = HtmlInCanvas;
var RenderSvgWithTiming = ({
  premountFor,
  postmountFor,
  styleWhilePremounted,
  styleWhilePostmounted,
  from,
  trimBefore,
  playbackRate,
  loop,
  freeze,
  hidden,
  showInTimeline,
  controls,
  durationInFrames,
  name,
  defaultName,
  documentationLink,
  memoizedEffectDefinitions,
  content,
  actualStyle
}) => {
  const {
    effectivePremountFor,
    effectivePostmountFor,
    freezeFrame,
    isPremountingOrPostmounting,
    premountingActive,
    postmountingActive,
    premountingStyle
  } = Internals.usePremounting({
    from: from ?? 0,
    durationInFrames: Internals.resolveSequenceDuration({
      durationInFrames,
      playbackRate,
      loop
    }),
    premountFor: premountFor ?? null,
    postmountFor: postmountFor ?? null,
    style: actualStyle,
    styleWhilePremounted: styleWhilePremounted ?? null,
    styleWhilePostmounted: styleWhilePostmounted ?? null,
    hideWhilePremounted: "opacity"
  });
  return /* @__PURE__ */ jsx(Freeze, {
    frame: freezeFrame,
    active: isPremountingOrPostmounting,
    children: /* @__PURE__ */ jsx(Sequence, {
      layout: "none",
      from,
      trimBefore,
      playbackRate,
      loop,
      freeze,
      hidden,
      showInTimeline,
      controls,
      _remotionInternalEffects: memoizedEffectDefinitions,
      durationInFrames,
      name: name ?? defaultName,
      _remotionInternalDocumentationLink: documentationLink,
      _remotionInternalPremountDisplay: effectivePremountFor || null,
      _remotionInternalPostmountDisplay: effectivePostmountFor || null,
      _remotionInternalIsPremounting: premountingActive,
      _remotionInternalIsPostmounting: postmountingActive,
      children: React.cloneElement(content, { style: premountingStyle ?? undefined })
    })
  });
};
var RenderSvg = ({
  defaultName,
  documentationLink,
  width,
  height,
  path,
  style,
  pathStyle,
  transformOrigin,
  debug,
  effects = [],
  effectsOutputSize,
  instructions,
  pixelDensity,
  durationInFrames,
  from,
  premountFor,
  postmountFor,
  styleWhilePremounted,
  styleWhilePostmounted,
  trimBefore,
  playbackRate,
  loop,
  freeze,
  hidden,
  name,
  showInTimeline,
  controls,
  ...props
}) => {
  const actualStyle = useMemo(() => {
    return {
      overflow: "visible",
      ...style ?? {}
    };
  }, [style]);
  const actualPathStyle = useMemo(() => {
    return {
      transformBox: "fill-box",
      ...pathStyle ?? {}
    };
  }, [pathStyle]);
  const memoizedEffectDefinitions = Internals.useMemoizedEffectDefinitions(effects);
  const videoConfig = Internals.useUnsafeVideoConfig();
  const reactSupportsTransformOrigin = doesReactSupportTransformOriginProperty(version);
  const svg = /* @__PURE__ */ jsxs("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    xmlns: "http://www.w3.org/2000/svg",
    style: effects.length === 0 || !videoConfig ? actualStyle : { overflow: "visible" },
    children: [
      /* @__PURE__ */ jsx("path", {
        ...reactSupportsTransformOrigin ? {
          transformOrigin
        } : {
          "transform-origin": transformOrigin
        },
        d: path,
        style: actualPathStyle,
        ...props
      }),
      debug ? instructions.map((i, index) => {
        if (i.type === "C") {
          const prevInstruction = index === 0 ? instructions[instructions.length - 1] : instructions[index - 1];
          if (prevInstruction.type === "V" || prevInstruction.type === "H" || prevInstruction.type === "a" || prevInstruction.type === "Z" || prevInstruction.type === "t" || prevInstruction.type === "q" || prevInstruction.type === "l" || prevInstruction.type === "c" || prevInstruction.type === "m" || prevInstruction.type === "h" || prevInstruction.type === "s" || prevInstruction.type === "v") {
            return null;
          }
          const prevX = prevInstruction.x;
          const prevY = prevInstruction.y;
          return /* @__PURE__ */ jsxs(React.Fragment, {
            children: [
              /* @__PURE__ */ jsx("path", {
                d: `M ${prevX} ${prevY} ${i.cp1x} ${i.cp1y}`,
                strokeWidth: 2,
                stroke: "rgba(0, 0, 0, 0.4)"
              }),
              /* @__PURE__ */ jsx("path", {
                d: `M ${i.x} ${i.y} ${i.cp2x} ${i.cp2y}`,
                strokeWidth: 2,
                stroke: "rgba(0, 0, 0, 0.4)"
              }),
              /* @__PURE__ */ jsx("circle", {
                cx: i.cp1x,
                cy: i.cp1y,
                r: 3,
                fill: "white",
                strokeWidth: 2,
                stroke: "black"
              }),
              /* @__PURE__ */ jsx("circle", {
                cx: i.cp2x,
                cy: i.cp2y,
                r: 3,
                strokeWidth: 2,
                fill: "white",
                stroke: "black"
              })
            ]
          }, index);
        }
        return null;
      }) : null
    ]
  });
  const content = effects.length === 0 ? svg : /* @__PURE__ */ jsx(HtmlInCanvasWithPrivateProps, {
    width: Math.ceil(width),
    height: Math.ceil(height),
    effects,
    effectsOutputSize,
    pixelDensity,
    showInTimeline: false,
    style: actualStyle,
    controls,
    children: svg
  });
  if (!videoConfig) {
    return svg;
  }
  return /* @__PURE__ */ jsx(RenderSvgWithTiming, {
    premountFor,
    postmountFor,
    styleWhilePremounted,
    styleWhilePostmounted,
    from,
    trimBefore,
    playbackRate,
    loop,
    freeze,
    hidden,
    showInTimeline,
    controls,
    durationInFrames,
    name,
    defaultName,
    documentationLink,
    memoizedEffectDefinitions,
    content,
    actualStyle
  });
};

// src/components/schema.ts
import {
  Internals as Internals2,
  Interactive
} from "@motionmox/core";
var numberField = ({
  defaultValue,
  description,
  hiddenFromList = false,
  integer,
  max,
  min,
  step = 1
}) => {
  return {
    type: "number",
    default: defaultValue,
    description,
    hiddenFromList,
    integer,
    max,
    min,
    step
  };
};
var booleanField = ({
  defaultValue,
  description
}) => {
  return {
    type: "boolean",
    default: defaultValue,
    description
  };
};
var colorField = ({
  defaultValue,
  description
}) => {
  return {
    type: "color",
    default: defaultValue,
    description
  };
};
var enumField = ({
  defaultValue,
  description,
  variants
}) => {
  return {
    type: "enum",
    default: defaultValue,
    description,
    variants: Object.fromEntries(variants.map((variant) => [variant, {}]))
  };
};
var makeShapeSchema = (shapeFields) => {
  return {
    ...Internals2.baseSchema,
    ...shapeFields,
    fill: colorField({
      defaultValue: "#0b84ff",
      description: "Fill"
    }),
    ...Internals2.transformSchema,
    ...Interactive.backgroundSchema,
    ...Interactive.borderSchema,
    ...Interactive.borderRadiusSchema
  };
};

// src/components/arrow.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
var arrowSchema = makeShapeSchema({
  length: numberField({
    defaultValue: 300,
    description: "Length",
    min: 0
  }),
  headWidth: numberField({
    defaultValue: 185,
    description: "Head Width",
    min: 0
  }),
  headLength: numberField({
    defaultValue: 120,
    description: "Head Length",
    min: 0
  }),
  shaftWidth: numberField({
    defaultValue: 80,
    description: "Shaft Width",
    min: 0
  }),
  direction: enumField({
    defaultValue: "right",
    description: "Direction",
    variants: ["right", "left", "up", "down"]
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var ArrowInner = ({
  length,
  headWidth,
  headLength,
  shaftWidth,
  direction,
  cornerRadius,
  ...props
}) => {
  return /* @__PURE__ */ jsx2(RenderSvg, {
    defaultName: "<Arrow>",
    documentationLink: "https://www.remotion.dev/docs/shapes/arrow",
    ...makeArrow({
      length,
      headWidth,
      headLength,
      shaftWidth,
      direction,
      cornerRadius
    }),
    ...props
  });
};
var Arrow = Interactive2.withSchema({
  Component: ArrowInner,
  componentName: "<Arrow>",
  componentIdentity: "dev.remotion.shapes.Arrow",
  schema: arrowSchema,
  supportsEffects: true
});
// src/components/callout.tsx
import { Interactive as Interactive3 } from "@motionmox/core";

// src/utils/make-callout.ts
import { serializeInstructions as serializeInstructions2 } from "@motionmox/paths";

// src/utils/join-points.ts
var shortenVector = (vector, radius) => {
  const [x, y] = vector;
  const currentLength = Math.sqrt(x * x + y * y);
  const scalingFactor = (currentLength - radius) / currentLength;
  return [x * scalingFactor, y * scalingFactor];
};
var scaleVectorToLength = (vector, length) => {
  const [x, y] = vector;
  const currentLength = Math.sqrt(x * x + y * y);
  const scalingFactor = length / currentLength;
  return [x * scalingFactor, y * scalingFactor];
};
var joinPoints = (points, {
  edgeRoundness,
  cornerRadius,
  roundCornerStrategy
}) => {
  return points.map(([x, y], i) => {
    const prevPointIndex = i === 0 ? points.length - 2 : i - 1;
    const prevPoint = points[prevPointIndex];
    const nextPointIndex = i === points.length - 1 ? 1 : i + 1;
    const nextPoint = points[nextPointIndex];
    const middleOfLine = [(x + nextPoint[0]) / 2, (y + nextPoint[1]) / 2];
    const prevPointMiddleOfLine = [
      (x + prevPoint[0]) / 2,
      (y + prevPoint[1]) / 2
    ];
    const prevVector = [x - prevPoint[0], y - prevPoint[1]];
    const nextVector = [nextPoint[0] - x, nextPoint[1] - y];
    if (i === 0) {
      if (edgeRoundness !== null) {
        return [
          {
            type: "M",
            x: middleOfLine[0],
            y: middleOfLine[1]
          }
        ];
      }
      if (cornerRadius !== 0) {
        const computeRadius = shortenVector(nextVector, cornerRadius);
        return [
          {
            type: "M",
            x: computeRadius[0] + x,
            y: computeRadius[1] + y
          }
        ];
      }
      return [
        {
          type: "M",
          x,
          y
        }
      ];
    }
    if (cornerRadius && edgeRoundness !== null) {
      throw new Error(`"cornerRadius" and "edgeRoundness" cannot be specified at the same time.`);
    }
    if (edgeRoundness === null) {
      if (cornerRadius === 0) {
        return [
          {
            type: "L",
            x,
            y
          }
        ];
      }
      const prevVectorMinusRadius = shortenVector(prevVector, cornerRadius);
      const prevVectorLength = scaleVectorToLength(prevVector, cornerRadius);
      const nextVectorMinusRadius = scaleVectorToLength(nextVector, cornerRadius);
      const firstDraw = [
        prevPoint[0] + prevVectorMinusRadius[0],
        prevPoint[1] + prevVectorMinusRadius[1]
      ];
      return [
        {
          type: "L",
          x: firstDraw[0],
          y: firstDraw[1]
        },
        roundCornerStrategy === "arc" ? {
          type: "a",
          rx: cornerRadius,
          ry: cornerRadius,
          xAxisRotation: 0,
          dx: prevVectorLength[0] + nextVectorMinusRadius[0],
          dy: prevVectorLength[1] + nextVectorMinusRadius[1],
          largeArcFlag: false,
          sweepFlag: true
        } : {
          type: "C",
          x: firstDraw[0] + prevVectorLength[0] + nextVectorMinusRadius[0],
          y: firstDraw[1] + prevVectorLength[1] + nextVectorMinusRadius[1],
          cp1x: x,
          cp1y: y,
          cp2x: x,
          cp2y: y
        }
      ];
    }
    const controlPoint1 = [
      prevPointMiddleOfLine[0] + prevVector[0] * edgeRoundness * 0.5,
      prevPointMiddleOfLine[1] + prevVector[1] * edgeRoundness * 0.5
    ];
    const controlPoint2 = [
      middleOfLine[0] - nextVector[0] * edgeRoundness * 0.5,
      middleOfLine[1] - nextVector[1] * edgeRoundness * 0.5
    ];
    return [
      {
        type: "C",
        cp1x: controlPoint1[0],
        cp1y: controlPoint1[1],
        cp2x: controlPoint2[0],
        cp2y: controlPoint2[1],
        x: middleOfLine[0],
        y: middleOfLine[1]
      }
    ];
  }).flat(1);
};

// src/utils/make-callout.ts
var ensurePositive = (name, value) => {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`"${name}" must be a positive number, got ${value}`);
  }
};
var pointerInterval = ({
  availableLength,
  pointerBaseWidth,
  pointerPosition
}) => {
  const center = availableLength * pointerPosition;
  const half = pointerBaseWidth / 2;
  return {
    center,
    start: Math.max(0, center - half),
    end: Math.min(availableLength, center + half)
  };
};
var areSamePoint = (a, b) => {
  return a[0] === b[0] && a[1] === b[1];
};
var normalizeClosedPoints = (points) => {
  const deduplicated = points.reduce((acc, entry) => {
    const previous = acc[acc.length - 1];
    if (previous && areSamePoint(previous.point, entry.point)) {
      acc[acc.length - 1] = {
        point: previous.point,
        round: previous.round && entry.round
      };
      return acc;
    }
    return [...acc, entry];
  }, []);
  if (deduplicated.length === 0) {
    return deduplicated;
  }
  const first = deduplicated[0];
  const last = deduplicated[deduplicated.length - 1];
  if (areSamePoint(first.point, last.point)) {
    const [firstEntry, ...rest] = deduplicated;
    const withoutLast = rest.slice(0, -1);
    const mergedFirst = {
      point: firstEntry.point,
      round: firstEntry.round && last.round
    };
    return [mergedFirst, ...withoutLast, mergedFirst];
  }
  return [...deduplicated, first];
};
var unitDir2 = (from, to) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return [0, 0];
  }
  return [dx / len, dy / len];
};
var makeInstructions = ({
  points,
  edgeRoundness,
  cornerRadius
}) => {
  const rawPoints = points.map((p) => p.point);
  if (edgeRoundness !== null || cornerRadius === 0) {
    return [
      ...joinPoints(rawPoints, {
        edgeRoundness,
        cornerRadius,
        roundCornerStrategy: "arc"
      }),
      {
        type: "Z"
      }
    ];
  }
  const uniquePoints = areSamePoint(points[0].point, points[points.length - 1].point) ? points.slice(0, -1) : points;
  const firstPoint = uniquePoints[0];
  const startDir = firstPoint.round ? unitDir2(uniquePoints[0].point, uniquePoints[1].point) : null;
  const startPoint = startDir ? [
    firstPoint.point[0] + startDir[0] * cornerRadius,
    firstPoint.point[1] + startDir[1] * cornerRadius
  ] : firstPoint.point;
  const instructions = [
    { type: "M", x: startPoint[0], y: startPoint[1] }
  ];
  for (let i = 1;i < uniquePoints.length; i++) {
    const current = uniquePoints[i];
    if (!current.round) {
      instructions.push({
        type: "L",
        x: current.point[0],
        y: current.point[1]
      });
      continue;
    }
    const previous = uniquePoints[i - 1].point;
    const next = uniquePoints[(i + 1) % uniquePoints.length].point;
    const incoming = unitDir2(previous, current.point);
    const outgoing = unitDir2(current.point, next);
    const arcStart = [
      current.point[0] - incoming[0] * cornerRadius,
      current.point[1] - incoming[1] * cornerRadius
    ];
    instructions.push({
      type: "L",
      x: arcStart[0],
      y: arcStart[1]
    }, {
      type: "a",
      rx: cornerRadius,
      ry: cornerRadius,
      xAxisRotation: 0,
      dx: incoming[0] * cornerRadius + outgoing[0] * cornerRadius,
      dy: incoming[1] * cornerRadius + outgoing[1] * cornerRadius,
      largeArcFlag: false,
      sweepFlag: true
    });
  }
  if (firstPoint.round) {
    const previous = uniquePoints[uniquePoints.length - 1].point;
    const incoming = unitDir2(previous, firstPoint.point);
    instructions.push({
      type: "L",
      x: firstPoint.point[0] - incoming[0] * cornerRadius,
      y: firstPoint.point[1] - incoming[1] * cornerRadius
    }, {
      type: "a",
      rx: cornerRadius,
      ry: cornerRadius,
      xAxisRotation: 0,
      dx: incoming[0] * cornerRadius + startDir[0] * cornerRadius,
      dy: incoming[1] * cornerRadius + startDir[1] * cornerRadius,
      largeArcFlag: false,
      sweepFlag: true
    });
  }
  instructions.push({ type: "Z" });
  return instructions;
};
var makeCallout = ({
  width = 500,
  height = 200,
  pointerLength = 40,
  pointerBaseWidth = 60,
  pointerPosition = 0.5,
  pointerDirection = "down",
  edgeRoundness = null,
  cornerRadius = 0
}) => {
  ensurePositive("width", width);
  ensurePositive("height", height);
  ensurePositive("pointerLength", pointerLength);
  ensurePositive("pointerBaseWidth", pointerBaseWidth);
  if (typeof pointerPosition !== "number" || pointerPosition < 0 || pointerPosition > 1) {
    throw new Error(`"pointerPosition" must be a number between 0 and 1, got ${pointerPosition}`);
  }
  const horizontalInterval = pointerInterval({
    availableLength: width,
    pointerBaseWidth,
    pointerPosition
  });
  const verticalInterval = pointerInterval({
    availableLength: height,
    pointerBaseWidth,
    pointerPosition
  });
  const pointsByDirection = {
    up: [
      { point: [0, pointerLength], round: true },
      { point: [horizontalInterval.start, pointerLength], round: false },
      { point: [horizontalInterval.center, 0], round: false },
      { point: [horizontalInterval.end, pointerLength], round: false },
      { point: [width, pointerLength], round: true },
      { point: [width, height + pointerLength], round: true },
      { point: [0, height + pointerLength], round: true },
      { point: [0, pointerLength], round: true }
    ],
    down: [
      { point: [0, 0], round: true },
      { point: [width, 0], round: true },
      { point: [width, height], round: true },
      { point: [horizontalInterval.end, height], round: false },
      {
        point: [horizontalInterval.center, height + pointerLength],
        round: false
      },
      { point: [horizontalInterval.start, height], round: false },
      { point: [0, height], round: true },
      { point: [0, 0], round: true }
    ],
    left: [
      { point: [pointerLength, 0], round: true },
      { point: [width + pointerLength, 0], round: true },
      { point: [width + pointerLength, height], round: true },
      { point: [pointerLength, height], round: true },
      { point: [pointerLength, verticalInterval.end], round: false },
      { point: [0, verticalInterval.center], round: false },
      { point: [pointerLength, verticalInterval.start], round: false },
      { point: [pointerLength, 0], round: true }
    ],
    right: [
      { point: [0, 0], round: true },
      { point: [width, 0], round: true },
      { point: [width, verticalInterval.start], round: false },
      { point: [width + pointerLength, verticalInterval.center], round: false },
      { point: [width, verticalInterval.end], round: false },
      { point: [width, height], round: true },
      { point: [0, height], round: true },
      { point: [0, 0], round: true }
    ]
  };
  const points = normalizeClosedPoints(pointsByDirection[pointerDirection]);
  const instructions = makeInstructions({ points, edgeRoundness, cornerRadius });
  const path = serializeInstructions2(instructions);
  const shapeWidth = pointerDirection === "left" || pointerDirection === "right" ? width + pointerLength : width;
  const shapeHeight = pointerDirection === "up" || pointerDirection === "down" ? height + pointerLength : height;
  const bodyX = pointerDirection === "left" ? pointerLength : 0;
  const bodyY = pointerDirection === "up" ? pointerLength : 0;
  return {
    width: shapeWidth,
    height: shapeHeight,
    instructions,
    path,
    transformOrigin: `${bodyX + width / 2} ${bodyY + height / 2}`
  };
};

// src/components/callout.tsx
import { jsx as jsx3 } from "react/jsx-runtime";
var calloutSchema = makeShapeSchema({
  width: numberField({
    defaultValue: 500,
    description: "Width",
    min: 1
  }),
  height: numberField({
    defaultValue: 200,
    description: "Height",
    min: 1
  }),
  pointerLength: numberField({
    defaultValue: 40,
    description: "Pointer Length",
    min: 1
  }),
  pointerBaseWidth: numberField({
    defaultValue: 60,
    description: "Pointer Base Width",
    min: 1
  }),
  pointerPosition: numberField({
    defaultValue: 0.5,
    description: "Pointer Position",
    min: 0,
    max: 1,
    step: 0.01
  }),
  pointerDirection: enumField({
    defaultValue: "down",
    description: "Pointer Direction",
    variants: ["up", "down", "left", "right"]
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var CalloutInner = ({
  width,
  height,
  pointerLength,
  pointerBaseWidth,
  pointerPosition,
  pointerDirection,
  edgeRoundness,
  cornerRadius,
  ...props
}) => {
  return /* @__PURE__ */ jsx3(RenderSvg, {
    defaultName: "<Callout>",
    documentationLink: "https://www.remotion.dev/docs/shapes/callout",
    ...makeCallout({
      width,
      height,
      pointerLength,
      pointerBaseWidth,
      pointerPosition,
      pointerDirection,
      edgeRoundness,
      cornerRadius
    }),
    ...props
  });
};
var Callout = Interactive3.withSchema({
  Component: CalloutInner,
  componentName: "<Callout>",
  componentIdentity: "dev.remotion.shapes.Callout",
  schema: calloutSchema,
  supportsEffects: true
});
// src/components/circle.tsx
import { Interactive as Interactive4 } from "@motionmox/core";

// src/utils/make-circle.ts
import { serializeInstructions as serializeInstructions3 } from "@motionmox/paths";
var makeCircle = ({ radius }) => {
  const instructions = [
    {
      type: "M",
      x: radius,
      y: 0
    },
    {
      type: "a",
      rx: radius,
      ry: radius,
      xAxisRotation: 0,
      largeArcFlag: true,
      sweepFlag: true,
      dx: 0,
      dy: radius * 2
    },
    {
      type: "a",
      rx: radius,
      ry: radius,
      xAxisRotation: 0,
      largeArcFlag: true,
      sweepFlag: true,
      dx: 0,
      dy: -radius * 2
    },
    {
      type: "Z"
    }
  ];
  const path = serializeInstructions3(instructions);
  return {
    height: radius * 2,
    width: radius * 2,
    path,
    instructions,
    transformOrigin: `${radius} ${radius}`
  };
};

// src/components/circle.tsx
import { jsx as jsx4 } from "react/jsx-runtime";
var circleSchema = makeShapeSchema({
  radius: numberField({
    defaultValue: 100,
    description: "Radius",
    min: 0
  })
});
var CircleInner = ({ radius, ...props }) => {
  return /* @__PURE__ */ jsx4(RenderSvg, {
    defaultName: "<Circle>",
    documentationLink: "https://www.remotion.dev/docs/shapes/circle",
    ...makeCircle({ radius }),
    ...props
  });
};
var Circle = Interactive4.withSchema({
  Component: CircleInner,
  componentName: "<Circle>",
  componentIdentity: "dev.remotion.shapes.Circle",
  schema: circleSchema,
  supportsEffects: true
});
// src/components/ellipse.tsx
import { Interactive as Interactive5 } from "@motionmox/core";

// src/utils/make-ellipse.ts
import { serializeInstructions as serializeInstructions4 } from "@motionmox/paths";
var makeEllipse = ({ rx, ry }) => {
  const instructions = [
    {
      type: "M",
      x: rx,
      y: 0
    },
    {
      type: "a",
      rx,
      ry,
      xAxisRotation: 0,
      largeArcFlag: true,
      sweepFlag: false,
      dx: 1,
      dy: 0
    },
    {
      type: "Z"
    }
  ];
  const path = serializeInstructions4(instructions);
  return {
    width: rx * 2,
    height: ry * 2,
    path,
    instructions,
    transformOrigin: `${rx} ${ry}`
  };
};

// src/components/ellipse.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
var ellipseSchema = makeShapeSchema({
  rx: numberField({
    defaultValue: 100,
    description: "X Radius",
    min: 0
  }),
  ry: numberField({
    defaultValue: 50,
    description: "Y Radius",
    min: 0
  })
});
var EllipseInner = ({ rx, ry, ...props }) => {
  return /* @__PURE__ */ jsx5(RenderSvg, {
    defaultName: "<Ellipse>",
    documentationLink: "https://www.remotion.dev/docs/shapes/ellipse",
    ...makeEllipse({ rx, ry }),
    ...props
  });
};
var Ellipse = Interactive5.withSchema({
  Component: EllipseInner,
  componentName: "<Ellipse>",
  componentIdentity: "dev.remotion.shapes.Ellipse",
  schema: ellipseSchema,
  supportsEffects: true
});
// src/components/heart.tsx
import { Interactive as Interactive6 } from "@motionmox/core";

// src/utils/make-heart.ts
import { serializeInstructions as serializeInstructions5 } from "@motionmox/paths";
var makeHeart = ({
  height,
  aspectRatio = 1.1,
  bottomRoundnessAdjustment = 0,
  depthAdjustment = 0
}) => {
  const width = height * aspectRatio;
  const bottomControlPointX = 23 / 110 * width + bottomRoundnessAdjustment * width;
  const bottomControlPointY = 69 / 100 * height;
  const bottomLeftControlPointY = 60 / 100 * height;
  const topLeftControlPoint = 13 / 100 * height;
  const topBezierWidth = 29 / 110 * width;
  const topRightControlPointX = 15 / 110 * width;
  const innerControlPointX = 5 / 110 * width;
  const innerControlPointY = 7 / 100 * height;
  const depth = 17 / 100 * height + depthAdjustment * height;
  const instructions = [
    {
      type: "M",
      x: width / 2,
      y: height
    },
    {
      type: "C",
      cp1x: width / 2 - bottomControlPointX,
      cp1y: bottomControlPointY,
      cp2x: 0,
      cp2y: bottomLeftControlPointY,
      x: 0,
      y: height / 4
    },
    {
      type: "C",
      cp1x: 0,
      cp1y: topLeftControlPoint,
      cp2x: width / 4 - topBezierWidth / 2,
      cp2y: 0,
      x: width / 4,
      y: 0
    },
    {
      type: "C",
      cp1x: width / 4 + topBezierWidth / 2,
      cp1y: 0,
      cp2x: width / 2 - innerControlPointX,
      cp2y: innerControlPointY,
      x: width / 2,
      y: depth
    },
    {
      type: "C",
      cp1x: width / 2 + innerControlPointX,
      cp1y: innerControlPointY,
      cp2x: width / 2 + topRightControlPointX,
      cp2y: 0,
      x: width / 4 * 3,
      y: 0
    },
    {
      type: "C",
      cp1x: width / 4 * 3 + topBezierWidth / 2,
      cp1y: 0,
      cp2x: width,
      cp2y: topLeftControlPoint,
      x: width,
      y: height / 4
    },
    {
      type: "C",
      x: width / 2,
      y: height,
      cp1x: width,
      cp1y: bottomLeftControlPointY,
      cp2x: width / 2 + bottomControlPointX,
      cp2y: bottomControlPointY
    },
    {
      type: "Z"
    }
  ];
  const path = serializeInstructions5(instructions);
  return {
    path,
    width,
    height,
    transformOrigin: `${width / 2} ${height / 2}`,
    instructions
  };
};

// src/components/heart.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
var heartSchema = makeShapeSchema({
  height: numberField({
    defaultValue: 100,
    description: "Height",
    min: 0
  }),
  aspectRatio: numberField({
    defaultValue: 1.1,
    description: "Aspect Ratio",
    min: 0,
    step: 0.01
  }),
  bottomRoundnessAdjustment: numberField({
    defaultValue: 0,
    description: "Bottom Roundness Adjustment",
    step: 0.01
  }),
  depthAdjustment: numberField({
    defaultValue: 0,
    description: "Depth Adjustment",
    step: 0.01
  })
});
var HeartInner = ({
  aspectRatio,
  height,
  bottomRoundnessAdjustment = 0,
  depthAdjustment = 0,
  ...props
}) => {
  return /* @__PURE__ */ jsx6(RenderSvg, {
    defaultName: "<Heart>",
    documentationLink: "https://www.remotion.dev/docs/shapes/heart",
    ...makeHeart({
      aspectRatio,
      height,
      bottomRoundnessAdjustment,
      depthAdjustment
    }),
    ...props
  });
};
var Heart = Interactive6.withSchema({
  Component: HeartInner,
  componentName: "<Heart>",
  componentIdentity: "dev.remotion.shapes.Heart",
  schema: heartSchema,
  supportsEffects: true
});
// src/components/pie.tsx
import { Interactive as Interactive7 } from "@motionmox/core";

// src/utils/make-pie.ts
import { serializeInstructions as serializeInstructions6 } from "@motionmox/paths";
var getCoord = ({
  counterClockwise,
  actualProgress,
  rotation,
  radius,
  coord
}) => {
  const factor = counterClockwise ? -1 : 1;
  const val = Math[coord === "x" ? "cos" : "sin"](factor * actualProgress * Math.PI * 2 + Math.PI * 1.5 + rotation) * radius + radius;
  const rounded = Math.round(val * 1e5) / 1e5;
  return rounded;
};
var makePie = ({
  progress,
  radius,
  closePath = true,
  counterClockwise = false,
  rotation = 0
}) => {
  const actualProgress = Math.min(Math.max(progress, 0), 1);
  const endAngleX = getCoord({
    actualProgress,
    coord: "x",
    counterClockwise,
    radius,
    rotation
  });
  const endAngleY = getCoord({
    actualProgress,
    coord: "y",
    counterClockwise,
    radius,
    rotation
  });
  const start = {
    x: getCoord({
      actualProgress: 0,
      coord: "x",
      counterClockwise,
      radius,
      rotation
    }),
    y: getCoord({
      actualProgress: 0,
      coord: "y",
      counterClockwise,
      radius,
      rotation
    })
  };
  const end = { x: endAngleX, y: endAngleY };
  const instructions = [
    {
      type: "M",
      ...start
    },
    {
      type: "A",
      rx: radius,
      ry: radius,
      xAxisRotation: 0,
      largeArcFlag: false,
      sweepFlag: !counterClockwise,
      x: actualProgress <= 0.5 ? endAngleX : getCoord({
        actualProgress: 0.5,
        coord: "x",
        counterClockwise,
        radius,
        rotation
      }),
      y: actualProgress <= 0.5 ? endAngleY : getCoord({
        actualProgress: 0.5,
        coord: "y",
        counterClockwise,
        radius,
        rotation
      })
    },
    actualProgress > 0.5 ? {
      type: "A",
      rx: radius,
      ry: radius,
      xAxisRotation: 0,
      largeArcFlag: false,
      sweepFlag: !counterClockwise,
      ...end
    } : null,
    actualProgress > 0 && actualProgress < 1 && closePath ? {
      type: "L",
      x: radius,
      y: radius
    } : null,
    closePath ? {
      type: "Z"
    } : null
  ].filter(Boolean);
  const path = serializeInstructions6(instructions);
  return {
    height: radius * 2,
    width: radius * 2,
    path,
    instructions,
    transformOrigin: `${radius} ${radius}`
  };
};

// src/components/pie.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
var pieSchema = makeShapeSchema({
  radius: numberField({
    defaultValue: 100,
    description: "Radius",
    min: 0
  }),
  progress: numberField({
    defaultValue: 0.5,
    description: "Progress",
    max: 1,
    min: 0,
    step: 0.01
  }),
  closePath: booleanField({
    defaultValue: true,
    description: "Close Path"
  }),
  counterClockwise: booleanField({
    defaultValue: false,
    description: "Counter Clockwise"
  }),
  rotation: numberField({
    defaultValue: 0,
    description: "Rotation",
    step: 0.01
  })
});
var PieInner = ({
  radius,
  progress,
  closePath,
  counterClockwise,
  rotation,
  ...props
}) => {
  return /* @__PURE__ */ jsx7(RenderSvg, {
    defaultName: "<Pie>",
    documentationLink: "https://www.remotion.dev/docs/shapes/pie",
    ...makePie({ radius, progress, closePath, counterClockwise, rotation }),
    ...props
  });
};
var Pie = Interactive7.withSchema({
  Component: PieInner,
  componentName: "<Pie>",
  componentIdentity: "dev.remotion.shapes.Pie",
  schema: pieSchema,
  supportsEffects: true
});
// src/components/polygon.tsx
import { Interactive as Interactive8 } from "@motionmox/core";

// src/utils/make-polygon.ts
import {
  PathInternals,
  reduceInstructions,
  resetPath,
  serializeInstructions as serializeInstructions7
} from "@motionmox/paths";
function polygon({
  points,
  radius,
  centerX,
  centerY,
  cornerRadius,
  edgeRoundness
}) {
  const degreeIncrement = Math.PI * 2 / points;
  const d = new Array(points).fill(0).map((_, i) => {
    const angle = degreeIncrement * i - Math.PI / 2;
    const point = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
    return [point.x, point.y];
  });
  return joinPoints([...d, d[0]], {
    edgeRoundness,
    cornerRadius,
    roundCornerStrategy: cornerRadius > 0 ? "bezier" : "arc"
  });
}
var makePolygon = ({
  points,
  radius,
  cornerRadius = 0,
  edgeRoundness = null
}) => {
  if (points < 3) {
    throw new Error(`"points" should be minimum 3, got ${points}`);
  }
  const width = 2 * radius;
  const height = 2 * radius;
  const centerX = width / 2;
  const centerY = height / 2;
  const polygonPathInstructions = polygon({
    points,
    radius,
    centerX,
    centerY,
    cornerRadius,
    edgeRoundness
  });
  const reduced = reduceInstructions(polygonPathInstructions);
  const path = resetPath(serializeInstructions7(reduced));
  const boundingBox = PathInternals.getBoundingBoxFromInstructions(reduced);
  return {
    path,
    width: boundingBox.width,
    height: boundingBox.height,
    transformOrigin: `${centerX} ${centerY}`,
    instructions: polygonPathInstructions
  };
};

// src/components/polygon.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
var polygonSchema = makeShapeSchema({
  points: numberField({
    defaultValue: 5,
    description: "Points",
    min: 3,
    step: 1,
    integer: true
  }),
  radius: numberField({
    defaultValue: 100,
    description: "Radius",
    min: 0
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var PolygonInner = ({
  points,
  radius,
  cornerRadius,
  edgeRoundness,
  ...props
}) => {
  return /* @__PURE__ */ jsx8(RenderSvg, {
    defaultName: "<Polygon>",
    documentationLink: "https://www.remotion.dev/docs/shapes/polygon",
    ...makePolygon({
      points,
      cornerRadius,
      edgeRoundness,
      radius
    }),
    ...props
  });
};
var Polygon = Interactive8.withSchema({
  Component: PolygonInner,
  componentName: "<Polygon>",
  componentIdentity: "dev.remotion.shapes.Polygon",
  schema: polygonSchema,
  supportsEffects: true
});
// src/components/rect.tsx
import { Interactive as Interactive9 } from "@motionmox/core";

// src/utils/make-rect.ts
import { serializeInstructions as serializeInstructions8 } from "@motionmox/paths";
var makeRect = ({
  width,
  height,
  edgeRoundness = null,
  cornerRadius = 0
}) => {
  const transformOrigin = [width / 2, height / 2];
  const instructions = [
    ...joinPoints([
      [cornerRadius, 0],
      [width, 0],
      [width, height],
      [0, height],
      [0, 0]
    ], { edgeRoundness, cornerRadius, roundCornerStrategy: "arc" }),
    {
      type: "Z"
    }
  ];
  const path = serializeInstructions8(instructions);
  return {
    width,
    height,
    instructions,
    path,
    transformOrigin: transformOrigin.join(" ")
  };
};

// src/components/rect.tsx
import { jsx as jsx9 } from "react/jsx-runtime";
var rectSchema = makeShapeSchema({
  width: numberField({
    defaultValue: 100,
    description: "Width",
    min: 0
  }),
  height: numberField({
    defaultValue: 100,
    description: "Height",
    min: 0
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var RectInner = ({
  width,
  edgeRoundness,
  height,
  cornerRadius,
  ...props
}) => {
  return /* @__PURE__ */ jsx9(RenderSvg, {
    defaultName: "<Rect>",
    documentationLink: "https://www.remotion.dev/docs/shapes/rect",
    ...makeRect({ height, width, edgeRoundness, cornerRadius }),
    ...props
  });
};
var Rect = Interactive9.withSchema({
  Component: RectInner,
  componentName: "<Rect>",
  componentIdentity: "dev.remotion.shapes.Rect",
  schema: rectSchema,
  supportsEffects: true
});
// src/components/spark.tsx
import { Interactive as Interactive10 } from "@motionmox/core";

// src/utils/make-spark.ts
import { serializeInstructions as serializeInstructions9 } from "@motionmox/paths";
var KAPPA = 0.5522847498307936;
var CAP_HANDLE = 4 / 3;
var curve = ({
  to,
  cp1,
  cp2
}) => {
  return {
    type: "C",
    cp1x: cp1[0],
    cp1y: cp1[1],
    cp2x: cp2[0],
    cp2y: cp2[1],
    x: to[0],
    y: to[1]
  };
};
var cap = ({
  from,
  to,
  radius,
  direction
}) => {
  if (direction === "top") {
    return curve({
      to,
      cp1: [from[0], from[1] - radius * CAP_HANDLE],
      cp2: [to[0], to[1] - radius * CAP_HANDLE]
    });
  }
  if (direction === "right") {
    return curve({
      to,
      cp1: [from[0] + radius * CAP_HANDLE, from[1]],
      cp2: [to[0] + radius * CAP_HANDLE, to[1]]
    });
  }
  if (direction === "bottom") {
    return curve({
      to,
      cp1: [from[0], from[1] + radius * CAP_HANDLE],
      cp2: [to[0], to[1] + radius * CAP_HANDLE]
    });
  }
  return curve({
    to,
    cp1: [from[0] - radius * CAP_HANDLE, from[1]],
    cp2: [to[0] - radius * CAP_HANDLE, to[1]]
  });
};
var edge = ({
  from,
  to,
  edgeRoundness,
  direction
}) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const handleX = Math.abs(dx) * KAPPA * edgeRoundness;
  const handleY = Math.abs(dy) * KAPPA * edgeRoundness;
  if (direction === "top-right") {
    return curve({
      to,
      cp1: [from[0], from[1] + handleY],
      cp2: [to[0] - handleX, to[1]]
    });
  }
  if (direction === "right-bottom") {
    return curve({
      to,
      cp1: [from[0] - handleX, from[1]],
      cp2: [to[0], to[1] - handleY]
    });
  }
  if (direction === "bottom-left") {
    return curve({
      to,
      cp1: [from[0], from[1] - handleY],
      cp2: [to[0] + handleX, to[1]]
    });
  }
  return curve({
    to,
    cp1: [from[0] + handleX, from[1]],
    cp2: [to[0], to[1] + handleY]
  });
};
var clampCornerRadius = ({
  cornerRadius,
  width,
  height
}) => {
  return Math.min(Math.max(cornerRadius, 0), width / 2, height / 2);
};
var makeSpark = ({
  width,
  height,
  edgeRoundness = 1,
  cornerRadius = 0
}) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = clampCornerRadius({ cornerRadius, width, height });
  const top = [centerX, 0];
  const right = [width, centerY];
  const bottom = [centerX, height];
  const left = [0, centerY];
  const topRight = radius === 0 ? top : [centerX + radius, radius];
  const rightTop = radius === 0 ? right : [width - radius, centerY - radius];
  const rightBottom = radius === 0 ? right : [width - radius, centerY + radius];
  const bottomRight = radius === 0 ? bottom : [centerX + radius, height - radius];
  const bottomLeft = radius === 0 ? bottom : [centerX - radius, height - radius];
  const leftBottom = radius === 0 ? left : [radius, centerY + radius];
  const leftTop = radius === 0 ? left : [radius, centerY - radius];
  const topLeft = radius === 0 ? top : [centerX - radius, radius];
  const instructions = [
    {
      type: "M",
      x: topRight[0],
      y: topRight[1]
    },
    edge({
      from: topRight,
      to: rightTop,
      edgeRoundness,
      direction: "top-right"
    })
  ];
  if (radius > 0) {
    instructions.push(cap({ from: rightTop, to: rightBottom, radius, direction: "right" }));
  }
  instructions.push(edge({
    from: rightBottom,
    to: bottomRight,
    edgeRoundness,
    direction: "right-bottom"
  }));
  if (radius > 0) {
    instructions.push(cap({ from: bottomRight, to: bottomLeft, radius, direction: "bottom" }));
  }
  instructions.push(edge({
    from: bottomLeft,
    to: leftBottom,
    edgeRoundness,
    direction: "bottom-left"
  }));
  if (radius > 0) {
    instructions.push(cap({ from: leftBottom, to: leftTop, radius, direction: "left" }));
  }
  instructions.push(edge({
    from: leftTop,
    to: topLeft,
    edgeRoundness,
    direction: "left-top"
  }));
  if (radius > 0) {
    instructions.push(cap({ from: topLeft, to: topRight, radius, direction: "top" }));
  }
  instructions.push({ type: "Z" });
  return {
    path: serializeInstructions9(instructions),
    width,
    height,
    transformOrigin: `${centerX} ${centerY}`,
    instructions
  };
};

// src/components/spark.tsx
import { jsx as jsx10 } from "react/jsx-runtime";
var sparkSchema = makeShapeSchema({
  width: numberField({
    defaultValue: 100,
    description: "Width",
    min: 0
  }),
  height: numberField({
    defaultValue: 140,
    description: "Height",
    min: 0
  }),
  edgeRoundness: numberField({
    defaultValue: 1,
    description: "Edge Roundness",
    min: 0,
    step: 0.01
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var SparkInner = ({
  width,
  height,
  edgeRoundness,
  cornerRadius,
  ...props
}) => {
  return /* @__PURE__ */ jsx10(RenderSvg, {
    defaultName: "<Spark>",
    documentationLink: "https://www.remotion.dev/docs/shapes/spark",
    ...makeSpark({ width, height, edgeRoundness, cornerRadius }),
    ...props
  });
};
var Spark = Interactive10.withSchema({
  Component: SparkInner,
  componentName: "<Spark>",
  componentIdentity: "dev.remotion.shapes.Spark",
  schema: sparkSchema,
  supportsEffects: true
});
// src/components/star.tsx
import { Interactive as Interactive11 } from "@motionmox/core";

// src/utils/make-star.ts
import {
  PathInternals as PathInternals2,
  reduceInstructions as reduceInstructions2,
  resetPath as resetPath2,
  serializeInstructions as serializeInstructions10
} from "@motionmox/paths";
var star = ({
  centerX,
  centerY,
  points,
  innerRadius,
  outerRadius,
  cornerRadius,
  edgeRoundness
}) => {
  const degreeIncrement = Math.PI * 2 / (points * 2);
  const d = new Array(points * 2).fill(true).map((_p, i) => {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = degreeIncrement * i - Math.PI / 2;
    const point = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
    return [point.x, point.y];
  });
  return [
    ...joinPoints([...d, d[0]], {
      edgeRoundness,
      cornerRadius,
      roundCornerStrategy: cornerRadius > 0 ? "bezier" : "arc"
    }),
    { type: "Z" }
  ];
};
var makeStar = ({
  points,
  innerRadius,
  outerRadius,
  cornerRadius = 0,
  edgeRoundness = null
}) => {
  if (points < 3) {
    throw new Error(`"points" should be minimum 3, got ${points}`);
  }
  const width = outerRadius * 2;
  const height = outerRadius * 2;
  const centerX = width / 2;
  const centerY = height / 2;
  const starPathInstructions = star({
    centerX,
    centerY,
    points,
    innerRadius,
    outerRadius,
    cornerRadius,
    edgeRoundness
  });
  const reduced = reduceInstructions2(starPathInstructions);
  const path = resetPath2(serializeInstructions10(reduced));
  const boundingBox = PathInternals2.getBoundingBoxFromInstructions(reduced);
  return {
    path,
    width: boundingBox.width,
    height: boundingBox.height,
    transformOrigin: `${centerX} ${centerY}`,
    instructions: starPathInstructions
  };
};

// src/components/star.tsx
import { jsx as jsx11 } from "react/jsx-runtime";
var starSchema = makeShapeSchema({
  points: numberField({
    defaultValue: 5,
    description: "Points",
    min: 3,
    step: 1,
    integer: true
  }),
  innerRadius: numberField({
    defaultValue: 50,
    description: "Inner Radius",
    min: 0
  }),
  outerRadius: numberField({
    defaultValue: 100,
    description: "Outer Radius",
    min: 0
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var StarInner = ({
  innerRadius,
  outerRadius,
  points,
  cornerRadius,
  edgeRoundness,
  ...props
}) => {
  return /* @__PURE__ */ jsx11(RenderSvg, {
    defaultName: "<Star>",
    documentationLink: "https://www.remotion.dev/docs/shapes/star",
    ...makeStar({
      innerRadius,
      outerRadius,
      points,
      cornerRadius,
      edgeRoundness
    }),
    ...props
  });
};
var Star = Interactive11.withSchema({
  Component: StarInner,
  componentName: "<Star>",
  componentIdentity: "dev.remotion.shapes.Star",
  schema: starSchema,
  supportsEffects: true
});
// src/components/triangle.tsx
import { Interactive as Interactive12 } from "@motionmox/core";

// src/utils/make-triangle.ts
import { serializeInstructions as serializeInstructions11 } from "@motionmox/paths";
var makeTriangle = ({
  length,
  direction = "right",
  edgeRoundness = null,
  cornerRadius = 0
}) => {
  if (typeof length !== "number") {
    throw new Error(`"length" of a triangle must be a number, got ${JSON.stringify(length)}`);
  }
  const longerDimension = length;
  const shorterSize = Math.sqrt(length ** 2 * 0.75);
  const points = {
    up: [
      [longerDimension / 2, 0],
      [0, shorterSize],
      [longerDimension, shorterSize],
      [longerDimension / 2, 0]
    ],
    right: [
      [0, 0],
      [0, longerDimension],
      [shorterSize, longerDimension / 2],
      [0, 0]
    ],
    down: [
      [0, 0],
      [longerDimension, 0],
      [longerDimension / 2, shorterSize],
      [0, 0]
    ],
    left: [
      [shorterSize, 0],
      [shorterSize, longerDimension],
      [0, longerDimension / 2],
      [shorterSize, 0]
    ]
  };
  const transformOriginX = {
    left: shorterSize / 3 * 2,
    right: shorterSize / 3,
    up: longerDimension / 2,
    down: longerDimension / 2
  }[direction];
  const transformOriginY = {
    up: shorterSize / 3 * 2,
    down: shorterSize / 3,
    left: longerDimension / 2,
    right: longerDimension / 2
  }[direction];
  const instructions = [
    ...joinPoints(points[direction], {
      edgeRoundness,
      cornerRadius,
      roundCornerStrategy: "bezier"
    }),
    {
      type: "Z"
    }
  ];
  const path = serializeInstructions11(instructions);
  return {
    path,
    instructions,
    width: direction === "up" || direction === "down" ? length : shorterSize,
    height: direction === "up" || direction === "down" ? shorterSize : length,
    transformOrigin: `${transformOriginX} ${transformOriginY}`
  };
};

// src/components/triangle.tsx
import { jsx as jsx12 } from "react/jsx-runtime";
var triangleSchema = makeShapeSchema({
  length: numberField({
    defaultValue: 100,
    description: "Length",
    min: 0
  }),
  direction: enumField({
    defaultValue: "right",
    description: "Direction",
    variants: ["right", "left", "up", "down"]
  }),
  cornerRadius: numberField({
    defaultValue: 0,
    description: "Corner Radius",
    min: 0
  })
});
var TriangleInner = ({
  length,
  direction,
  edgeRoundness,
  cornerRadius,
  ...props
}) => {
  return /* @__PURE__ */ jsx12(RenderSvg, {
    defaultName: "<Triangle>",
    documentationLink: "https://www.remotion.dev/docs/shapes/triangle",
    ...makeTriangle({ length, direction, edgeRoundness, cornerRadius }),
    ...props
  });
};
var Triangle = Interactive12.withSchema({
  Component: TriangleInner,
  componentName: "<Triangle>",
  componentIdentity: "dev.remotion.shapes.Triangle",
  schema: triangleSchema,
  supportsEffects: true
});
export {
  Arrow,
  Callout,
  Circle,
  Ellipse,
  Heart,
  Pie,
  Polygon,
  Rect,
  Spark,
  Star,
  Triangle,
  makeArrow,
  makeCallout,
  makeCircle,
  makeEllipse,
  makeHeart,
  makePie,
  makePolygon,
  makeRect,
  makeSpark,
  makeStar,
  makeTriangle
};
