"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDeferredCapturedPointerSession = exports.startCapturedPointerSession = exports.observePointerRelease = exports.isPointerSessionRelease = void 0;
const sdk_1 = require("@motionmox/sdk");
({ isPointerSessionRelease: exports.isPointerSessionRelease, observePointerRelease: exports.observePointerRelease, startCapturedPointerSession: exports.startCapturedPointerSession, startDeferredCapturedPointerSession: exports.startDeferredCapturedPointerSession } = sdk_1.CanvasInternals);
