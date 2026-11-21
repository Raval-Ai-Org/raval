// src/html-in-canvas-presentation.tsx
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  getHtmlInCanvasUnsupportedMessage,
  HtmlInCanvas,
  Internals,
  useCurrentFrame,
  useDelayRender,
  useRemotionEnvironment
} from "@motionmox/core";
import { jsx, jsxs } from "react/jsx-runtime";
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
  const canvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const canvasSubtreeStyle = useMemo(() => {
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
  const outputCanvasStyle = useMemo(() => {
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
  const captureCanvasRef = useRef(null);
  const captureContextRef = useRef(null);
  const [shaderCanvas] = useState(() => new OffscreenCanvas(1, 1));
  const passedPropsRef = useRef(passedProps);
  passedPropsRef.current = passedProps;
  const memoizedEffects = Internals.useMemoizedEffects({
    effects: effects ?? [],
    overrideId: null,
    runtimeValues: null,
    videoConfigValues: null
  });
  const effectsRef = useRef(memoizedEffects);
  effectsRef.current = memoizedEffects;
  const instanceRef = useRef(null);
  const videoEnabled = Internals.useVideoEnabled();
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
  const chainState = Internals.useEffectChainState(effectsOutputSize);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const { isRendering } = useRemotionEnvironment();
  const frame = useCurrentFrame();
  const renderFrame = isRendering ? frame : null;
  const draw = useCallback(async (prevImage, nextImage, progress) => {
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
      await Internals.runEffectChain({
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
  return /* @__PURE__ */ jsxs(AbsoluteFill, {
    showInTimeline: false,
    children: [
      /* @__PURE__ */ jsx("canvas", {
        ref: canvasRef,
        style: canvasSubtreeStyle,
        children: /* @__PURE__ */ jsx("div", {
          style: canvasSubtreeStyle,
          children
        })
      }),
      /* @__PURE__ */ jsx("canvas", {
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
    return /* @__PURE__ */ jsx(Internals.HtmlInCanvasFallback, {
      label: "Transition is not visible",
      style: {
        position: "absolute",
        inset: 0,
        visibility: visible ? "visible" : "hidden"
      },
      children: props.children
    });
  }
  return /* @__PURE__ */ jsx(HtmlInCanvasPresentationWithSupport, {
    ...props
  });
};
var makeHtmlInCanvasPresentation = (shader) => {
  const CompWithShader = (props) => {
    const { passedProps, ...otherProps } = props;
    const { effects, effectsOutputSize, ...restPassedProps } = props.passedProps;
    return /* @__PURE__ */ jsx(HtmlInCanvasPresentation, {
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

// src/presentations/linear-blur.tsx
var VERTEX_SHADER = `#version 300 es
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
var createProgram = (gl) => {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program");
  }
  const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
  const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
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
  const program = createProgram(gl);
  const prevTex = createTexture(gl);
  const nextTex = createTexture(gl);
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
export {
  linearBlur,
  linearBlurShader
};
