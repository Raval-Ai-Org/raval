import {
  ModelManager
} from "./index-ysd4g3ev.mjs";

// src/components/VideoMatting/Models.tsx
import {
  downloadVideoMattingModel,
  getAvailableModels,
  isVideoMattingModelCached,
  removeVideoMattingModel
} from "@motionmox/video-matting";
import { useCallback } from "react";
import { jsx } from "react/jsx-runtime";
var AVAILABLE_MODELS = getAvailableModels();
var Models2 = ({ description, indent, visible }) => {
  const isModelCached = useCallback((model) => isVideoMattingModelCached({ model }), []);
  const loadModel = useCallback((model, onProgress) => downloadVideoMattingModel({
    model,
    onProgress: (progress) => onProgress(progress.progress)
  }), []);
  const removeModel = useCallback((model) => removeVideoMattingModel({ model }), []);
  return /* @__PURE__ */ jsx(ModelManager, {
    ariaLabel: "Video matting models",
    availableModels: AVAILABLE_MODELS,
    description,
    indent,
    isModelCached,
    loadModel,
    prepare: null,
    removeModel,
    visible
  });
};

export { Models2 };
