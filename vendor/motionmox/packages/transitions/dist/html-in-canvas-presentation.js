"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeHtmlInCanvasPresentation = exports.HtmlInCanvasPresentation = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const core_1 = require("@motionmox/core");
const transferredCanvases = new WeakMap();
const HtmlInCanvasPresentationWithSupport = ({ children, onElementImage, onUnmount, presentationProgress, presentationDirection, shader, effects, effectsOutputSize, passedProps, bothEnteringAndExiting, }) => {
    const canvasRef = (0, react_1.useRef)(null);
    const outputCanvasRef = (0, react_1.useRef)(null);
    const canvasSubtreeStyle = (0, react_1.useMemo)(() => {
        return {
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
        };
    }, []);
    const outputCanvasStyle = (0, react_1.useMemo)(() => {
        return {
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
        };
    }, []);
    const captureCanvasRef = (0, react_1.useRef)(null);
    const captureContextRef = (0, react_1.useRef)(null);
    const [shaderCanvas] = (0, react_1.useState)(() => new OffscreenCanvas(1, 1));
    const passedPropsRef = (0, react_1.useRef)(passedProps);
    passedPropsRef.current = passedProps;
    const memoizedEffects = core_1.Internals.useMemoizedEffects({
        effects: effects !== null && effects !== void 0 ? effects : [],
        overrideId: null,
        runtimeValues: null,
        videoConfigValues: null,
    });
    const effectsRef = (0, react_1.useRef)(memoizedEffects);
    effectsRef.current = memoizedEffects;
    const instanceRef = (0, react_1.useRef)(null);
    const videoEnabled = core_1.Internals.useVideoEnabled();
    // Audio-only frames keep the scenes mounted without capturing or drawing them.
    const passThrough = !videoEnabled ||
        (bothEnteringAndExiting && presentationDirection === 'exiting');
    (0, react_1.useLayoutEffect)(() => {
        if (passThrough) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        // Activity can reconnect effects while retaining the same DOM canvas.
        let captureCanvas = transferredCanvases.get(canvas);
        if (!captureCanvas) {
            captureCanvas = canvas.transferControlToOffscreen();
            transferredCanvases.set(canvas, captureCanvas);
        }
        const captureContext = captureCanvas.getContext('2d');
        if (!captureContext) {
            throw new Error('Failed to create capture canvas context');
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
    const chainState = core_1.Internals.useEffectChainState(effectsOutputSize);
    const { delayRender, continueRender, cancelRender } = (0, core_1.useDelayRender)();
    const { isRendering } = (0, core_1.useRemotionEnvironment)();
    const frame = (0, core_1.useCurrentFrame)();
    // Like <HtmlInCanvas>, wait for a paint on every frame only while rendering.
    const renderFrame = isRendering ? frame : null;
    const draw = (0, react_1.useCallback)(async (prevImage, nextImage, progress) => {
        var _a, _b, _c, _d, _e;
        const instance = instanceRef.current;
        if (!instance) {
            return;
        }
        const outputCanvas = outputCanvasRef.current;
        if (!outputCanvas) {
            throw new Error('Canvas not found');
        }
        const handle = delayRender('onPaint');
        try {
            const clearOutput = () => {
                const context = outputCanvas.getContext('2d');
                if (!context) {
                    throw new Error('Failed to create output canvas context');
                }
                context.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
            };
            if (!prevImage && !nextImage) {
                instance.clear();
                clearOutput();
                continueRender(handle);
                return;
            }
            const width = (_b = (_a = prevImage === null || prevImage === void 0 ? void 0 : prevImage.width) !== null && _a !== void 0 ? _a : nextImage === null || nextImage === void 0 ? void 0 : nextImage.width) !== null && _b !== void 0 ? _b : 0;
            const height = (_d = (_c = prevImage === null || prevImage === void 0 ? void 0 : prevImage.height) !== null && _c !== void 0 ? _c : nextImage === null || nextImage === void 0 ? void 0 : nextImage.height) !== null && _d !== void 0 ? _d : 0;
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
                passedProps: passedPropsRef.current,
            });
            await core_1.Internals.runEffectChain({
                state: chainState.get(width, height),
                source: shaderCanvas,
                effects: (_e = effectsRef.current) !== null && _e !== void 0 ? _e : [],
                width,
                height,
                output: outputCanvas,
            });
            continueRender(handle);
        }
        catch (error) {
            cancelRender(error);
        }
    }, [cancelRender, chainState, continueRender, delayRender, shaderCanvas]);
    (0, react_1.useLayoutEffect)(() => {
        if (passThrough) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        if (canvas.getAttribute('content') !== 'drawable') {
            canvas.setAttribute('content', 'drawable');
        }
        if (canvas.layoutSubtree !== true) {
            canvas.layoutSubtree = true;
        }
        const firstChild = canvas.firstElementChild;
        if (firstChild && !firstChild.hasAttribute('drawable')) {
            firstChild.setAttribute('drawable', '');
        }
    });
    (0, react_1.useLayoutEffect)(() => {
        if (passThrough) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            throw new Error('Canvas not found');
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
            }
            finally {
                elementImage.close();
            }
            onElementImage(captureCanvas, draw);
        };
        canvas.addEventListener('paint', onPaint);
        return () => {
            canvas.removeEventListener('paint', onPaint);
        };
    }, [onElementImage, presentationDirection, draw, passThrough]);
    (0, react_1.useLayoutEffect)(() => {
        var _a;
        if (passThrough) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            throw new Error('Canvas not found');
        }
        // Block capture before the paint event begins, so a frame is not taken
        // from the previous scene image. draw() holds its own handle through async work.
        const handle = delayRender('waiting for transition paint');
        const onPainted = () => {
            continueRender(handle);
        };
        canvas.addEventListener('paint', onPainted, { once: true });
        (_a = canvas.requestPaint) === null || _a === void 0 ? void 0 : _a.call(canvas);
        return () => {
            canvas.removeEventListener('paint', onPainted);
            onPainted();
        };
    }, [
        presentationProgress,
        passThrough,
        memoizedEffects,
        chainState,
        renderFrame,
        continueRender,
        delayRender,
    ]);
    (0, react_1.useLayoutEffect)(() => {
        if (passThrough) {
            return;
        }
        return () => {
            onUnmount();
        };
    }, [onUnmount, passThrough]);
    (0, react_1.useLayoutEffect)(() => {
        if (passThrough) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        // Size the canvas grid to match the device scale factor to prevent blurriness.
        const observer = new ResizeObserver(([entry]) => {
            var _a;
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
            (_a = canvas.requestPaint) === null || _a === void 0 ? void 0 : _a.call(canvas);
        });
        observer.observe(canvas, { box: 'device-pixel-content-box' });
        return () => {
            observer.disconnect();
        };
    }, [passThrough]);
    if (passThrough) {
        return children;
    }
    return ((0, jsx_runtime_1.jsxs)(core_1.AbsoluteFill, { showInTimeline: false, children: [(0, jsx_runtime_1.jsx)("canvas", { ref: canvasRef, style: canvasSubtreeStyle, children: (0, jsx_runtime_1.jsx)("div", { style: canvasSubtreeStyle, children: children }) }), (0, jsx_runtime_1.jsx)("canvas", { ref: outputCanvasRef, style: outputCanvasStyle })] }));
};
const HtmlInCanvasPresentation = (props) => {
    const { isRendering } = (0, core_1.useRemotionEnvironment)();
    if (!core_1.HtmlInCanvas.isSupported()) {
        if (isRendering) {
            throw new Error((0, core_1.getHtmlInCanvasUnsupportedMessage)());
        }
        const visible = props.presentationDirection === 'entering'
            ? props.presentationProgress >= 0.5
            : props.presentationProgress < 0.5;
        return ((0, jsx_runtime_1.jsx)(core_1.Internals.HtmlInCanvasFallback, { label: "Transition is not visible", style: {
                position: 'absolute',
                inset: 0,
                visibility: visible ? 'visible' : 'hidden',
            }, children: props.children }));
    }
    return (0, jsx_runtime_1.jsx)(HtmlInCanvasPresentationWithSupport, { ...props });
};
exports.HtmlInCanvasPresentation = HtmlInCanvasPresentation;
const makeHtmlInCanvasPresentation = (shader) => {
    const CompWithShader = (props) => {
        const { passedProps, ...otherProps } = props;
        const { effects, effectsOutputSize, ...restPassedProps } = props.passedProps;
        return ((0, jsx_runtime_1.jsx)(exports.HtmlInCanvasPresentation, { shader: shader, passedProps: restPassedProps, effects: effects !== null && effects !== void 0 ? effects : null, effectsOutputSize: effectsOutputSize !== null && effectsOutputSize !== void 0 ? effectsOutputSize : null, ...otherProps }));
    };
    return (props) => {
        return {
            component: CompWithShader,
            props,
        };
    };
};
exports.makeHtmlInCanvasPresentation = makeHtmlInCanvasPresentation;
