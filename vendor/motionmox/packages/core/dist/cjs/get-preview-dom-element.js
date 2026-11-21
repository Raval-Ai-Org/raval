"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPreviewDomElement = exports.MOTIONMOX_STUDIO_CONTAINER_ELEMENT = void 0;
exports.MOTIONMOX_STUDIO_CONTAINER_ELEMENT = '__remotion-studio-container';
const getPreviewDomElement = () => {
    return document.getElementById(exports.MOTIONMOX_STUDIO_CONTAINER_ELEMENT);
};
exports.getPreviewDomElement = getPreviewDomElement;
