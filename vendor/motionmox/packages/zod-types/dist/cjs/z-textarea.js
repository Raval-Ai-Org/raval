"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zTextarea = exports.MOTIONMOX_TEXTAREA_BRAND = void 0;
const zod_1 = require("zod");
exports.MOTIONMOX_TEXTAREA_BRAND = '__remotion-textarea';
const zTextarea = () => zod_1.z.string().describe(exports.MOTIONMOX_TEXTAREA_BRAND);
exports.zTextarea = zTextarea;
