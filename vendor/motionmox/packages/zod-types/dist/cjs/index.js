"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodZypesInternals = exports.zTextarea = exports.zMatrix = exports.zColor = void 0;
const z_color_js_1 = require("./z-color.js");
const z_matrix_js_1 = require("./z-matrix.js");
const z_textarea_1 = require("./z-textarea");
var z_color_js_2 = require("./z-color.js");
Object.defineProperty(exports, "zColor", { enumerable: true, get: function () { return z_color_js_2.zColor; } });
var z_matrix_js_2 = require("./z-matrix.js");
Object.defineProperty(exports, "zMatrix", { enumerable: true, get: function () { return z_matrix_js_2.zMatrix; } });
var z_textarea_js_1 = require("./z-textarea.js");
Object.defineProperty(exports, "zTextarea", { enumerable: true, get: function () { return z_textarea_js_1.zTextarea; } });
exports.ZodZypesInternals = {
    parseColor: z_color_js_1.parseColor,
    MOTIONMOX_COLOR_BRAND: z_color_js_1.MOTIONMOX_COLOR_BRAND,
    MOTIONMOX_TEXTAREA_BRAND: z_textarea_1.MOTIONMOX_TEXTAREA_BRAND,
    MOTIONMOX_MATRIX_BRAND: z_matrix_js_1.MOTIONMOX_MATRIX_BRAND,
};
