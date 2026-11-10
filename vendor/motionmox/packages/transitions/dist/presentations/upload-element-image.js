"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadElementImage = void 0;
const uploadElementImage = (gl, elementImage) => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elementImage);
};
exports.uploadElementImage = uploadElementImage;
