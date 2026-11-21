"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EFFECT_CATALOG = exports.getEffectCatalogCategories = exports.getEffectPreviewAlt = exports.getEffectPreviewSource = exports.getEffectDocumentationLink = exports.getEffectDocumentationPath = void 0;
const getEffectDocumentationPath = (item) => {
    return `/docs/effects/${item.id.slice('effects-'.length)}`;
};
exports.getEffectDocumentationPath = getEffectDocumentationPath;
const getEffectDocumentationLink = (item) => {
    return `https://www.remotion.dev${(0, exports.getEffectDocumentationPath)(item)}`;
};
exports.getEffectDocumentationLink = getEffectDocumentationLink;
const getEffectPreviewSource = (item) => {
    if (item.id === 'effects-lightning') {
        return `https://remotion.media/docs/effects/${item.id}-preview-v3.png`;
    }
    if (item.id === 'effects-evolve' || item.id === 'effects-rain-fall') {
        return `https://remotion.media/docs/effects/${item.id}-preview-v2.png`;
    }
    return `https://remotion.media/docs/effects/${item.id}-preview.png`;
};
exports.getEffectPreviewSource = getEffectPreviewSource;
const getEffectPreviewAlt = (item) => {
    const effectName = item.id
        .slice('effects-'.length)
        .replaceAll('-', ' ')
        .replace(/^uv /, 'UV ')
        .replace(/^xy /, 'XY ')
        .replace(/^tv /, 'TV ');
    return `${effectName} effect preview`;
};
exports.getEffectPreviewAlt = getEffectPreviewAlt;
const getEffectCatalogCategories = (items) => {
    const categories = [];
    for (const item of items) {
        const last = categories[categories.length - 1];
        if ((last === null || last === void 0 ? void 0 : last.title) === item.category) {
            categories[categories.length - 1] = {
                ...last,
                effects: [...last.effects, item],
            };
            continue;
        }
        categories.push({
            title: item.category,
            effects: [item],
        });
    }
    return categories;
};
exports.getEffectCatalogCategories = getEffectCatalogCategories;
const DEFAULT_LUT_CONTENT = `TITLE "Teal and orange"
LUT_3D_SIZE 2

0.02 0.05 0.08
0.95 0.12 0.06
0.02 0.8 0.4
1 0.9 0.18
0.08 0.18 0.9
0.95 0.2 0.75
0.15 0.88 0.92
1 0.92 0.78`;
exports.EFFECT_CATALOG = [
    {
        id: 'effects-brightness',
        category: 'Color',
        label: 'brightness()',
        description: 'Brightness adjustment effect',
        effect: {
            name: 'brightness',
            importPath: '@motionmox/effects/brightness',
            config: {},
        },
    },
    {
        id: 'effects-contrast',
        category: 'Color',
        label: 'contrast()',
        description: 'Contrast adjustment effect',
        effect: {
            name: 'contrast',
            importPath: '@motionmox/effects/contrast',
            config: {},
        },
    },
    {
        id: 'effects-color-correction',
        category: 'Color',
        label: 'colorCorrection()',
        description: 'Combined primary color adjustments',
        effect: {
            name: 'colorCorrection',
            importPath: '@motionmox/effects/color-correction',
            config: {},
        },
    },
    {
        id: 'effects-color-key',
        category: 'Color',
        label: 'colorKey()',
        description: 'Remove a key color (greenscreen)',
        effect: {
            name: 'colorKey',
            importPath: '@motionmox/effects/color-key',
            config: {
                similarity: 0.45,
            },
        },
    },
    {
        id: 'effects-curves',
        category: 'Color',
        label: 'curves()',
        description: 'Adjust RGB or individual channels with a tonal curve',
        effect: {
            name: 'curves',
            importPath: '@motionmox/effects/curves',
            config: {},
        },
    },
    {
        id: 'effects-duotone',
        category: 'Color',
        label: 'duotone()',
        description: 'Two-color threshold effect',
        effect: {
            name: 'duotone',
            importPath: '@motionmox/effects/duotone',
            config: {},
        },
    },
    {
        id: 'effects-exposure',
        category: 'Color',
        label: 'exposure()',
        description: 'Stop-based exposure adjustment',
        effect: {
            name: 'exposure',
            importPath: '@motionmox/effects/exposure',
            config: {},
        },
    },
    {
        id: 'effects-grayscale',
        category: 'Color',
        label: 'grayscale()',
        description: 'Black-and-white effect',
        effect: {
            name: 'grayscale',
            importPath: '@motionmox/effects/grayscale',
            config: {},
        },
    },
    {
        id: 'effects-hue',
        category: 'Color',
        label: 'hue()',
        description: 'Hue rotation effect',
        effect: {
            name: 'hue',
            importPath: '@motionmox/effects/hue',
            config: {},
        },
    },
    {
        id: 'effects-invert',
        category: 'Color',
        label: 'invert()',
        description: 'Negative color effect',
        effect: {
            name: 'invert',
            importPath: '@motionmox/effects/invert',
            config: {},
        },
    },
    {
        id: 'effects-levels',
        category: 'Color',
        label: 'levels()',
        description: 'Black point, white point, and gamma',
        effect: {
            name: 'levels',
            importPath: '@motionmox/effects/levels',
            config: {},
        },
    },
    {
        id: 'effects-lut',
        category: 'Color',
        label: 'lut()',
        description: 'Apply an inline 3D Cube LUT',
        effect: {
            name: 'lut',
            importPath: '@motionmox/effects/lut',
            config: {
                content: DEFAULT_LUT_CONTENT,
            },
        },
    },
    {
        id: 'effects-saturation',
        category: 'Color',
        label: 'saturation()',
        description: 'Saturation adjustment effect',
        effect: {
            name: 'saturation',
            importPath: '@motionmox/effects/saturation',
            config: {},
        },
    },
    {
        id: 'effects-shadows-highlights',
        category: 'Color',
        label: 'shadowsHighlights()',
        description: 'Recover dark and bright tonal regions',
        effect: {
            name: 'shadowsHighlights',
            importPath: '@motionmox/effects/shadows-highlights',
            config: {},
        },
    },
    {
        id: 'effects-tint',
        category: 'Color',
        label: 'tint()',
        description: 'Color tint effect',
        effect: {
            name: 'tint',
            importPath: '@motionmox/effects/tint',
            config: {
                color: '#1ec8ff',
            },
        },
    },
    {
        id: 'effects-white-balance',
        category: 'Color',
        label: 'whiteBalance()',
        description: 'Temperature and tint correction',
        effect: {
            name: 'whiteBalance',
            importPath: '@motionmox/effects/white-balance',
            config: {},
        },
    },
    {
        id: 'effects-vibrance',
        category: 'Color',
        label: 'vibrance()',
        description: 'Selective saturation adjustment',
        effect: {
            name: 'vibrance',
            importPath: '@motionmox/effects/vibrance',
            config: {},
        },
    },
    {
        id: 'effects-linear-gradient',
        category: 'Color',
        label: 'linearGradient()',
        description: 'Two-stop gradient effect',
        effect: {
            name: 'linearGradient',
            importPath: '@motionmox/effects/linear-gradient',
            config: {},
        },
    },
    {
        id: 'effects-linear-gradient-tint',
        category: 'Color',
        label: 'linearGradientTint()',
        description: 'Gradient tint effect',
        effect: {
            name: 'linearGradientTint',
            importPath: '@motionmox/effects/linear-gradient-tint',
            config: {},
        },
    },
    {
        id: 'effects-thermal-vision',
        category: 'Color',
        label: 'thermalVision()',
        description: 'Thermal heat-map color effect',
        effect: {
            name: 'thermalVision',
            importPath: '@motionmox/effects/thermal-vision',
            config: {},
        },
    },
    {
        id: 'effects-blur',
        category: 'Blur & Shadow',
        label: 'blur()',
        description: 'Gaussian blur effect',
        effect: {
            name: 'blur',
            importPath: '@motionmox/effects/blur',
            config: {
                radius: 40,
            },
        },
    },
    {
        id: 'effects-lens-blur',
        category: 'Blur & Shadow',
        label: 'lensBlur()',
        description: 'Camera defocus with shaped bokeh',
        effect: {
            name: 'lensBlur',
            importPath: '@motionmox/effects/lens-blur',
            config: {},
        },
    },
    {
        id: 'effects-linear-progressive-blur',
        category: 'Blur & Shadow',
        label: 'linearProgressiveBlur()',
        description: 'Gradient-controlled blur effect',
        effect: {
            name: 'linearProgressiveBlur',
            importPath: '@motionmox/effects/linear-progressive-blur',
            config: {},
        },
    },
    {
        id: 'effects-radial-progressive-blur',
        category: 'Blur & Shadow',
        label: 'radialProgressiveBlur()',
        description: 'Ellipse-controlled blur effect',
        effect: {
            name: 'radialProgressiveBlur',
            importPath: '@motionmox/effects/radial-progressive-blur',
            config: {},
        },
    },
    {
        id: 'effects-region-blur',
        category: 'Blur & Shadow',
        label: 'regionBlur()',
        description: 'Blur a rectangular or rounded region',
        effect: {
            name: 'regionBlur',
            importPath: '@motionmox/effects/region-blur',
            config: {
                topLeft: [0.28, 0.18],
                bottomRight: [0.72, 0.82],
            },
        },
    },
    {
        id: 'effects-zoom-blur',
        category: 'Blur & Shadow',
        label: 'zoomBlur()',
        description: 'Radial zoom blur effect',
        effect: {
            name: 'zoomBlur',
            importPath: '@motionmox/effects/zoom-blur',
            config: {},
        },
    },
    {
        id: 'effects-drop-shadow',
        category: 'Blur & Shadow',
        label: 'dropShadow()',
        description: 'Blurred alpha shadow effect',
        effect: {
            name: 'dropShadow',
            importPath: '@motionmox/effects/drop-shadow',
            config: {},
        },
    },
    {
        id: 'effects-long-shadows',
        category: 'Blur & Shadow',
        label: 'longShadows()',
        description: 'Solid directional shadow or faux extrusion',
        effect: {
            name: 'longShadows',
            importPath: '@motionmox/effects/long-shadows',
            config: {},
        },
    },
    {
        id: 'effects-glow',
        category: 'Blur & Shadow',
        label: 'glow()',
        description: 'Soft halo effect',
        effect: {
            name: 'glow',
            importPath: '@motionmox/effects/glow',
            config: {},
        },
    },
    {
        id: 'effects-outline',
        category: 'Blur & Shadow',
        label: 'outline()',
        description: 'Solid alpha outline effect',
        effect: {
            name: 'outline',
            importPath: '@motionmox/effects/outline',
            config: {
                width: 12,
                color: '#00ffff',
            },
        },
    },
    {
        id: 'effects-light-trail',
        category: 'Blur & Shadow',
        label: 'lightTrail()',
        description: 'Directional light trail effect',
        effect: {
            name: 'lightTrail',
            importPath: '@motionmox/effects/light-trail',
            config: {},
        },
    },
    {
        id: 'effects-evolve',
        category: 'Reveal',
        label: 'evolve()',
        description: 'Directional reveal with angle and feathering',
        effect: {
            name: 'evolve',
            importPath: '@motionmox/effects/evolve',
            config: {
                progress: 0.5,
                direction: 'angle',
                angle: 60,
                featherUnit: 'pixels',
                featherPixels: 60,
            },
        },
    },
    {
        id: 'effects-tear',
        category: 'Reveal',
        label: 'tear()',
        description: 'Progressive zigzag tear with outward rotation',
        effect: { name: 'tear', importPath: '@motionmox/effects/tear', config: {} },
    },
    {
        id: 'effects-film-burn',
        category: 'Reveal',
        label: 'filmBurn()',
        description: 'Irregular burn holes with charred and glowing edges',
        effect: {
            name: 'filmBurn',
            importPath: '@motionmox/effects/film-burn',
            config: {
                progress: 0.4,
                center: [0.5, 0.5],
                seed: 0,
            },
        },
    },
    {
        id: 'effects-radial-wipe',
        category: 'Reveal',
        label: 'radialWipe()',
        description: 'Rotating wedge wipe around a center point',
        effect: {
            name: 'radialWipe',
            importPath: '@motionmox/effects/radial-wipe',
            config: {
                progress: 0.3,
                startAngle: 0,
                center: [0.5, 0.5],
                direction: 'clockwise',
                feather: 8,
            },
        },
    },
    {
        id: 'effects-iris-wipe',
        category: 'Reveal',
        label: 'irisWipe()',
        description: 'Polygon or star opening with feathered edges',
        effect: {
            name: 'irisWipe',
            importPath: '@motionmox/effects/iris-wipe',
            config: {
                center: [0.5, 0.5],
                points: 5,
                outerRadius: 300,
                useInnerRadius: true,
                innerRadius: 140,
                rotation: 0,
                feather: 12,
            },
        },
    },
    {
        id: 'effects-venetian-blinds',
        category: 'Reveal',
        label: 'venetianBlinds()',
        description: 'Slatted reveal effect',
        effect: {
            name: 'venetianBlinds',
            importPath: '@motionmox/effects/venetian-blinds',
            config: {},
        },
    },
    {
        id: 'effects-mirror',
        category: 'Transform',
        label: 'mirror()',
        description: 'Mirror reflection effect',
        effect: {
            name: 'mirror',
            importPath: '@motionmox/effects/mirror',
            config: {},
        },
    },
    {
        id: 'effects-scale',
        category: 'Transform',
        label: 'scale()',
        description: 'Scale transform effect',
        effect: {
            name: 'scale',
            importPath: '@motionmox/effects/scale',
            config: {
                scale: 1,
            },
        },
    },
    {
        id: 'effects-tile',
        category: 'Transform',
        label: 'tile()',
        description: 'Repeat the visible source bounds',
        effect: {
            name: 'tile',
            importPath: '@motionmox/effects/tile',
            config: {},
        },
    },
    {
        id: 'effects-uv-translate',
        category: 'Transform',
        label: 'uvTranslate()',
        description: 'UV-based translate effect',
        effect: {
            name: 'uvTranslate',
            importPath: '@motionmox/effects/translate',
            config: {},
        },
    },
    {
        id: 'effects-xy-translate',
        category: 'Transform',
        label: 'xyTranslate()',
        description: 'Pixel-based translate effect',
        effect: {
            name: 'xyTranslate',
            importPath: '@motionmox/effects/translate',
            config: {},
        },
    },
    {
        id: 'effects-barrel-distortion',
        category: 'Distort',
        label: 'barrelDistortion()',
        description: 'Barrel distortion effect',
        effect: {
            name: 'barrelDistortion',
            importPath: '@motionmox/effects/barrel-distortion',
            config: {},
        },
    },
    {
        id: 'effects-chromatic-aberration',
        category: 'Distort',
        label: 'chromaticAberration()',
        description: 'RGB channel split effect',
        effect: {
            name: 'chromaticAberration',
            importPath: '@motionmox/effects/chromatic-aberration',
            config: {},
        },
    },
    {
        id: 'effects-magnify',
        category: 'Distort',
        label: 'magnify()',
        description: 'Magnify a circular or square area',
        effect: {
            name: 'magnify',
            importPath: '@motionmox/effects/magnify',
            config: {},
        },
    },
    {
        id: 'effects-fisheye',
        category: 'Distort',
        label: 'fisheye()',
        description: 'Ultra-wide-angle lens effect',
        effect: {
            name: 'fisheye',
            importPath: '@motionmox/effects/fisheye',
            config: {},
        },
    },
    {
        id: 'effects-corner-pin',
        category: 'Distort',
        label: 'cornerPin()',
        description: 'Pin source corners to a quad',
        effect: {
            name: 'cornerPin',
            importPath: '@motionmox/effects/corner-pin',
            config: {
                topLeft: [0.08, 0.12],
                topRight: [0.92, 0.04],
                bottomRight: [0.86, 0.9],
                bottomLeft: [0.14, 0.96],
            },
        },
    },
    {
        id: 'effects-page-turn',
        category: 'Distort',
        label: 'pageTurn()',
        description: 'Curl a page with a shaded fold and paper back',
        effect: {
            name: 'pageTurn',
            importPath: '@motionmox/effects/page-turn',
            config: {},
        },
    },
    {
        id: 'effects-sphere',
        category: 'Distort',
        label: 'sphere()',
        description: 'Wrap content around a rotating sphere',
        effect: {
            name: 'sphere',
            importPath: '@motionmox/effects/sphere',
            config: {},
        },
    },
    {
        id: 'effects-cylinder',
        category: 'Distort',
        label: 'cylinder()',
        description: 'Wrap content around a rotating cylinder',
        effect: {
            name: 'cylinder',
            importPath: '@motionmox/effects/cylinder',
            config: {},
        },
    },
    {
        id: 'effects-wave',
        category: 'Distort',
        label: 'wave()',
        description: 'Sine wave distortion',
        effect: {
            name: 'wave',
            importPath: '@motionmox/effects/wave',
            config: {},
        },
    },
    {
        id: 'effects-skew',
        category: 'Distort',
        label: 'skew()',
        description: 'Skew the source on two axes',
        effect: {
            name: 'skew',
            importPath: '@motionmox/effects/skew',
            config: {},
        },
    },
    {
        id: 'effects-turbulent-displace',
        category: 'Distort',
        label: 'turbulentDisplace()',
        description: 'Evolving turbulent, bulge and twist distortion',
        effect: {
            name: 'turbulentDisplace',
            importPath: '@motionmox/effects/turbulent-displace',
            config: {},
        },
    },
    {
        id: 'effects-burlap',
        category: 'Stylize',
        label: 'burlap()',
        description: 'Procedural woven texture effect',
        effect: {
            name: 'burlap',
            importPath: '@motionmox/effects/burlap',
            config: {},
        },
    },
    {
        id: 'effects-bevel-alpha',
        category: 'Stylize',
        label: 'bevelAlpha()',
        description: 'Light and shade the edges of text and shapes',
        effect: {
            name: 'bevelAlpha',
            importPath: '@motionmox/effects/bevel-alpha',
            config: {},
        },
    },
    {
        id: 'effects-emboss',
        category: 'Stylize',
        label: 'emboss()',
        description: 'Procedural raised-line relief',
        effect: {
            name: 'emboss',
            importPath: '@motionmox/effects/emboss',
            config: {},
        },
    },
    {
        id: 'effects-dot-grid',
        category: 'Stylize',
        label: 'dotGrid()',
        description: 'Source-color dot mask effect',
        effect: {
            name: 'dotGrid',
            importPath: '@motionmox/effects/dot-grid',
            config: {},
        },
    },
    {
        id: 'effects-halftone',
        category: 'Stylize',
        label: 'halftone()',
        description: 'Source-image halftone effect',
        effect: {
            name: 'halftone',
            importPath: '@motionmox/effects/halftone',
            config: {},
        },
    },
    {
        id: 'effects-noise',
        category: 'Stylize',
        label: 'noise()',
        description: 'Procedural grain effect',
        effect: {
            name: 'noise',
            importPath: '@motionmox/effects/noise',
            config: {},
        },
    },
    {
        id: 'effects-noise-displacement',
        category: 'Stylize',
        label: 'noiseDisplacement()',
        description: 'Localized noisy displacement',
        effect: {
            name: 'noiseDisplacement',
            importPath: '@motionmox/effects/noise-displacement',
            config: {
                center: [0.6124309308853857, 0.5010527449123625],
                radius: 0.41,
                strength: 15.5,
                seed: 78,
                grainSize: 0.9,
                passes: 12,
                blur: 0,
                feather: 1,
                biasDirection: 313,
                biasAmount: 1,
            },
        },
    },
    {
        id: 'effects-paper',
        category: 'Stylize',
        label: 'paper()',
        description: 'Procedural paper texture effect',
        effect: {
            name: 'paper',
            importPath: '@motionmox/effects/paper',
            config: {},
        },
    },
    {
        id: 'effects-roughen-edges',
        category: 'Stylize',
        label: 'roughenEdges()',
        description: 'Procedural alpha-edge roughening',
        effect: {
            name: 'roughenEdges',
            importPath: '@motionmox/effects/roughen-edges',
            config: {},
        },
    },
    {
        id: 'effects-pattern',
        category: 'Stylize',
        label: 'pattern()',
        description: 'Repeated source tile effect',
        effect: {
            name: 'pattern',
            importPath: '@motionmox/effects/pattern',
            config: {},
        },
    },
    {
        id: 'effects-pixel-dissolve',
        category: 'Stylize',
        label: 'pixelDissolve()',
        description: 'Pixelated dissolve effect',
        effect: {
            name: 'pixelDissolve',
            importPath: '@motionmox/effects/pixel-dissolve',
            config: {},
        },
    },
    {
        id: 'effects-pixelate',
        category: 'Stylize',
        label: 'pixelate()',
        description: 'Pixelation effect',
        effect: {
            name: 'pixelate',
            importPath: '@motionmox/effects/pixelate',
            config: {
                blockSize: 20,
            },
        },
    },
    {
        id: 'effects-linear-progressive-pixelate',
        category: 'Stylize',
        label: 'linearProgressivePixelate()',
        description: 'Gradient-controlled pixelation',
        effect: {
            name: 'linearProgressivePixelate',
            importPath: '@motionmox/effects/linear-progressive-pixelate',
            config: {},
        },
    },
    {
        id: 'effects-radial-progressive-pixelate',
        category: 'Stylize',
        label: 'radialProgressivePixelate()',
        description: 'Ellipse-controlled pixelation',
        effect: {
            name: 'radialProgressivePixelate',
            importPath: '@motionmox/effects/radial-progressive-pixelate',
            config: {},
        },
    },
    {
        id: 'effects-scanlines',
        category: 'Stylize',
        label: 'scanlines()',
        description: 'Additive horizontal scanlines',
        effect: {
            name: 'scanlines',
            importPath: '@motionmox/effects/scanlines',
            config: {},
        },
    },
    {
        id: 'effects-speckle',
        category: 'Stylize',
        label: 'speckle()',
        description: 'Random alpha-hole effect',
        effect: {
            name: 'speckle',
            importPath: '@motionmox/effects/speckle',
            config: {},
        },
    },
    {
        id: 'effects-shatter',
        category: 'Stylize',
        label: 'shatter()',
        description: 'Break the source into tumbling fragments',
        effect: {
            name: 'shatter',
            importPath: '@motionmox/effects/shatter',
            config: {},
        },
    },
    {
        id: 'effects-shine',
        category: 'Stylize',
        label: 'shine()',
        description: 'Glossy light sweep effect',
        effect: {
            name: 'shine',
            importPath: '@motionmox/effects/shine',
            config: {},
        },
    },
    {
        id: 'effects-shrinkwrap',
        category: 'Stylize',
        label: 'shrinkwrap()',
        description: 'Procedural plastic wrap effect',
        effect: {
            name: 'shrinkwrap',
            importPath: '@motionmox/effects/shrinkwrap',
            config: {
                amount: 0.94,
                displacement: 13.5,
                highlightIntensity: 1.54,
                wrinkleDensity: 0.87,
                edgeTension: 0.58,
                phase: 0,
                seed: 12,
            },
        },
    },
    {
        id: 'effects-vignette',
        category: 'Stylize',
        label: 'vignette()',
        description: 'Edge darkening or transparency effect',
        effect: {
            name: 'vignette',
            importPath: '@motionmox/effects/vignette',
            config: {},
        },
    },
    {
        id: 'effects-lightning',
        category: 'Generate',
        label: 'lightning()',
        description: 'Forked lightning bolts with a colored glow',
        effect: {
            name: 'lightning',
            importPath: '@motionmox/effects/lightning',
            config: {},
        },
    },
    {
        id: 'effects-rain-fall',
        category: 'Generate',
        label: 'rainFall()',
        description: 'Falling rain with wind and depth',
        effect: {
            name: 'rainFall',
            importPath: '@motionmox/effects/rain-fall',
            config: {
                time: 1,
                drops: 100000,
                size: 2,
                wind: 200,
                opacity: 0.5,
            },
        },
    },
    {
        id: 'effects-snow-fall',
        category: 'Generate',
        label: 'snowFall()',
        description: 'Drifting snow with wind and depth',
        effect: {
            name: 'snowFall',
            importPath: '@motionmox/effects/snow-fall',
            config: {
                time: 1,
                flakes: 1500,
                size: 8,
            },
        },
    },
    {
        id: 'effects-fractal-noise',
        category: 'Generate',
        label: 'fractalNoise()',
        description: 'Evolving fractal noise textures',
        effect: {
            name: 'fractalNoise',
            importPath: '@motionmox/effects/fractal-noise',
            config: {},
        },
    },
    {
        id: 'effects-contour-lines',
        category: 'Generate',
        label: 'contourLines()',
        description: 'Topographic line overlay effect',
        effect: {
            name: 'contourLines',
            importPath: '@motionmox/effects/contour-lines',
            config: {},
        },
    },
    {
        id: 'effects-liquid-contours',
        category: 'Generate',
        label: 'liquidContours()',
        description: 'Two-color liquid contour background',
        effect: {
            name: 'liquidContours',
            importPath: '@motionmox/effects/liquid-contours',
            config: {},
        },
    },
    {
        id: 'effects-checkerboard',
        category: 'Generate',
        label: 'checkerboard()',
        description: 'Checkerboard pattern effect',
        effect: {
            name: 'checkerboard',
            importPath: '@motionmox/effects/checkerboard',
            config: {},
        },
    },
    {
        id: 'effects-flannel',
        category: 'Generate',
        label: 'flannel()',
        description: 'Plaid woven fabric pattern',
        effect: {
            name: 'flannel',
            importPath: '@motionmox/effects/flannel',
            config: {},
        },
    },
    {
        id: 'effects-halftone-linear-gradient',
        category: 'Generate',
        label: 'halftoneLinearGradient()',
        description: 'Procedural dot gradient effect',
        effect: {
            name: 'halftoneLinearGradient',
            importPath: '@motionmox/effects/halftone-linear-gradient',
            config: {},
        },
    },
    {
        id: 'effects-gridlines',
        category: 'Generate',
        label: 'gridlines()',
        description: 'Procedural grid pattern effect',
        effect: {
            name: 'gridlines',
            importPath: '@motionmox/effects/gridlines',
            config: {},
        },
    },
    {
        id: 'effects-white-noise',
        category: 'Generate',
        label: 'whiteNoise()',
        description: 'Random grayscale noise layer',
        effect: {
            name: 'whiteNoise',
            importPath: '@motionmox/effects/white-noise',
            config: {},
        },
    },
    {
        id: 'effects-tv-signal-off',
        category: 'Generate',
        label: 'tvSignalOff()',
        description: 'TV color bars test pattern',
        effect: {
            name: 'tvSignalOff',
            importPath: '@motionmox/effects/tv-signal-off',
            config: {},
        },
    },
    {
        id: 'effects-lines',
        category: 'Generate',
        label: 'lines()',
        description: 'Alternating line pattern effect',
        effect: {
            name: 'lines',
            importPath: '@motionmox/effects/lines',
            config: {},
        },
    },
    {
        id: 'effects-rings',
        category: 'Generate',
        label: 'rings()',
        description: 'Concentric ring pattern effect',
        effect: {
            name: 'rings',
            importPath: '@motionmox/effects/rings',
            config: {},
        },
    },
    {
        id: 'effects-waves',
        category: 'Generate',
        label: 'waves()',
        description: 'Wavy band pattern effect',
        effect: {
            name: 'waves',
            importPath: '@motionmox/effects/waves',
            config: {},
        },
    },
    {
        id: 'effects-zigzag',
        category: 'Generate',
        label: 'zigzag()',
        description: 'Zig-zag band pattern effect',
        effect: {
            name: 'zigzag',
            importPath: '@motionmox/effects/zigzag',
            config: {},
        },
    },
    {
        id: 'effects-light-leak',
        category: 'Generate',
        label: 'lightLeak()',
        description: 'Light leak overlay effect',
        effect: {
            name: 'lightLeak',
            importPath: '@motionmox/effects/light-leak',
            config: {},
        },
    },
    {
        id: 'effects-starburst',
        category: 'Generate',
        label: 'starburst()',
        description: 'Starburst ray effect',
        effect: {
            name: 'starburst',
            importPath: '@motionmox/effects/starburst',
            config: {
                rays: 16,
                colors: ['#ff6600', '#ffff00'],
            },
        },
    },
];
