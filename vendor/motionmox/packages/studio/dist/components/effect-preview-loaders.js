"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectPreviewLoaders = void 0;
// Keep the import paths explicit so each effect can load on demand in Studio.
exports.effectPreviewLoaders = {
    '@motionmox/effects/brightness': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/brightness/preview'))),
    '@motionmox/effects/contrast': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/contrast/preview'))),
    '@motionmox/effects/color-correction': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/color-correction/preview'))),
    '@motionmox/effects/color-key': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/color-key/preview'))),
    '@motionmox/effects/curves': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/curves/preview'))),
    '@motionmox/effects/duotone': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/duotone/preview'))),
    '@motionmox/effects/exposure': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/exposure/preview'))),
    '@motionmox/effects/grayscale': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/grayscale/preview'))),
    '@motionmox/effects/hue': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/hue/preview'))),
    '@motionmox/effects/invert': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/invert/preview'))),
    '@motionmox/effects/levels': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/levels/preview'))),
    '@motionmox/effects/lut': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/lut/preview'))),
    '@motionmox/effects/saturation': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/saturation/preview'))),
    '@motionmox/effects/shadows-highlights': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/shadows-highlights/preview'))),
    '@motionmox/effects/tint': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/tint/preview'))),
    '@motionmox/effects/white-balance': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/white-balance/preview'))),
    '@motionmox/effects/vibrance': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/vibrance/preview'))),
    '@motionmox/effects/linear-gradient': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/linear-gradient/preview'))),
    '@motionmox/effects/linear-gradient-tint': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/linear-gradient-tint/preview'))),
    '@motionmox/effects/thermal-vision': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/thermal-vision/preview'))),
    '@motionmox/effects/blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/blur/preview'))),
    '@motionmox/effects/lens-blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/lens-blur/preview'))),
    '@motionmox/effects/linear-progressive-blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/linear-progressive-blur/preview'))),
    '@motionmox/effects/radial-progressive-blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/radial-progressive-blur/preview'))),
    '@motionmox/effects/region-blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/region-blur/preview'))),
    '@motionmox/effects/zoom-blur': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/zoom-blur/preview'))),
    '@motionmox/effects/drop-shadow': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/drop-shadow/preview'))),
    '@motionmox/effects/long-shadows': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/long-shadows/preview'))),
    '@motionmox/effects/glow': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/glow/preview'))),
    '@motionmox/effects/outline': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/outline/preview'))),
    '@motionmox/effects/light-trail': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/light-trail/preview'))),
    '@motionmox/effects/evolve': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/evolve/preview'))),
    '@motionmox/effects/tear': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/tear/preview'))),
    '@motionmox/effects/film-burn': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/film-burn/preview'))),
    '@motionmox/effects/radial-wipe': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/radial-wipe/preview'))),
    '@motionmox/effects/iris-wipe': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/iris-wipe/preview'))),
    '@motionmox/effects/venetian-blinds': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/venetian-blinds/preview'))),
    '@motionmox/effects/mirror': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/mirror/preview'))),
    '@motionmox/effects/scale': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/scale/preview'))),
    '@motionmox/effects/tile': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/tile/preview'))),
    '@motionmox/effects/translate': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/translate/preview'))),
    '@motionmox/effects/barrel-distortion': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/barrel-distortion/preview'))),
    '@motionmox/effects/chromatic-aberration': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/chromatic-aberration/preview'))),
    '@motionmox/effects/magnify': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/magnify/preview'))),
    '@motionmox/effects/fisheye': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/fisheye/preview'))),
    '@motionmox/effects/corner-pin': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/corner-pin/preview'))),
    '@motionmox/effects/page-turn': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/page-turn/preview'))),
    '@motionmox/effects/sphere': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/sphere/preview'))),
    '@motionmox/effects/cylinder': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/cylinder/preview'))),
    '@motionmox/effects/wave': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/wave/preview'))),
    '@motionmox/effects/skew': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/skew/preview'))),
    '@motionmox/effects/turbulent-displace': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/turbulent-displace/preview'))),
    '@motionmox/effects/burlap': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/burlap/preview'))),
    '@motionmox/effects/bevel-alpha': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/bevel-alpha/preview'))),
    '@motionmox/effects/emboss': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/emboss/preview'))),
    '@motionmox/effects/dot-grid': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/dot-grid/preview'))),
    '@motionmox/effects/halftone': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/halftone/preview'))),
    '@motionmox/effects/noise': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/noise/preview'))),
    '@motionmox/effects/noise-displacement': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/noise-displacement/preview'))),
    '@motionmox/effects/paper': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/paper/preview'))),
    '@motionmox/effects/roughen-edges': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/roughen-edges/preview'))),
    '@motionmox/effects/pattern': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/pattern/preview'))),
    '@motionmox/effects/pixel-dissolve': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/pixel-dissolve/preview'))),
    '@motionmox/effects/pixelate': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/pixelate/preview'))),
    '@motionmox/effects/linear-progressive-pixelate': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/linear-progressive-pixelate/preview'))),
    '@motionmox/effects/radial-progressive-pixelate': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/radial-progressive-pixelate/preview'))),
    '@motionmox/effects/scanlines': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/scanlines/preview'))),
    '@motionmox/effects/speckle': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/speckle/preview'))),
    '@motionmox/effects/shatter': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/shatter/preview'))),
    '@motionmox/effects/shine': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/shine/preview'))),
    '@motionmox/effects/shrinkwrap': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/shrinkwrap/preview'))),
    '@motionmox/effects/vignette': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/vignette/preview'))),
    '@motionmox/effects/lightning': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/lightning/preview'))),
    '@motionmox/effects/rain-fall': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/rain-fall/preview'))),
    '@motionmox/effects/snow-fall': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/snow-fall/preview'))),
    '@motionmox/effects/fractal-noise': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/fractal-noise/preview'))),
    '@motionmox/effects/contour-lines': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/contour-lines/preview'))),
    '@motionmox/effects/liquid-contours': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/liquid-contours/preview'))),
    '@motionmox/effects/checkerboard': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/checkerboard/preview'))),
    '@motionmox/effects/flannel': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/flannel/preview'))),
    '@motionmox/effects/halftone-linear-gradient': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/halftone-linear-gradient/preview'))),
    '@motionmox/effects/gridlines': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/gridlines/preview'))),
    '@motionmox/effects/white-noise': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/white-noise/preview'))),
    '@motionmox/effects/tv-signal-off': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/tv-signal-off/preview'))),
    '@motionmox/effects/lines': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/lines/preview'))),
    '@motionmox/effects/rings': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/rings/preview'))),
    '@motionmox/effects/waves': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/waves/preview'))),
    '@motionmox/effects/zigzag': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/zigzag/preview'))),
    '@motionmox/effects/light-leak': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/light-leak/preview'))),
    '@motionmox/effects/starburst': () => Promise.resolve().then(() => __importStar(require('@motionmox/effects/starburst/preview'))),
};
// Rspack changes these imports when effects move between lazy and initial chunks.
// Keep those updates inside this stateless module instead of reloading Studio.
if (typeof __webpack_module__ !== 'undefined' &&
    typeof ((_a = __webpack_module__.hot) === null || _a === void 0 ? void 0 : _a.accept) === 'function') {
    __webpack_module__.hot.accept();
}
