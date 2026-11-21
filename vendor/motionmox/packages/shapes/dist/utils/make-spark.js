"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSpark = void 0;
const paths_1 = require("@motionmox/paths");
const KAPPA = 0.5522847498307936;
const CAP_HANDLE = 4 / 3;
const curve = ({ to, cp1, cp2, }) => {
    return {
        type: 'C',
        cp1x: cp1[0],
        cp1y: cp1[1],
        cp2x: cp2[0],
        cp2y: cp2[1],
        x: to[0],
        y: to[1],
    };
};
const cap = ({ from, to, radius, direction, }) => {
    if (direction === 'top') {
        return curve({
            to,
            cp1: [from[0], from[1] - radius * CAP_HANDLE],
            cp2: [to[0], to[1] - radius * CAP_HANDLE],
        });
    }
    if (direction === 'right') {
        return curve({
            to,
            cp1: [from[0] + radius * CAP_HANDLE, from[1]],
            cp2: [to[0] + radius * CAP_HANDLE, to[1]],
        });
    }
    if (direction === 'bottom') {
        return curve({
            to,
            cp1: [from[0], from[1] + radius * CAP_HANDLE],
            cp2: [to[0], to[1] + radius * CAP_HANDLE],
        });
    }
    return curve({
        to,
        cp1: [from[0] - radius * CAP_HANDLE, from[1]],
        cp2: [to[0] - radius * CAP_HANDLE, to[1]],
    });
};
const edge = ({ from, to, edgeRoundness, direction, }) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const handleX = Math.abs(dx) * KAPPA * edgeRoundness;
    const handleY = Math.abs(dy) * KAPPA * edgeRoundness;
    if (direction === 'top-right') {
        return curve({
            to,
            cp1: [from[0], from[1] + handleY],
            cp2: [to[0] - handleX, to[1]],
        });
    }
    if (direction === 'right-bottom') {
        return curve({
            to,
            cp1: [from[0] - handleX, from[1]],
            cp2: [to[0], to[1] - handleY],
        });
    }
    if (direction === 'bottom-left') {
        return curve({
            to,
            cp1: [from[0], from[1] - handleY],
            cp2: [to[0] + handleX, to[1]],
        });
    }
    return curve({
        to,
        cp1: [from[0] + handleX, from[1]],
        cp2: [to[0], to[1] + handleY],
    });
};
const clampCornerRadius = ({ cornerRadius, width, height, }) => {
    return Math.min(Math.max(cornerRadius, 0), width / 2, height / 2);
};
/**
 * @description Generates a spark SVG path.
 * @param {Number} width The width of the spark.
 * @param {Number} height The height of the spark.
 * @param {Number} edgeRoundness Controls the inward curvature between the points. Default 1.
 * @param {Number} cornerRadius Rounds the four points. Default 0.
 * @see [Documentation](https://www.remotion.dev/docs/shapes/make-spark)
 */
const makeSpark = ({ width, height, edgeRoundness = 1, cornerRadius = 0, }) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = clampCornerRadius({ cornerRadius, width, height });
    const top = [centerX, 0];
    const right = [width, centerY];
    const bottom = [centerX, height];
    const left = [0, centerY];
    const topRight = radius === 0 ? top : [centerX + radius, radius];
    const rightTop = radius === 0 ? right : [width - radius, centerY - radius];
    const rightBottom = radius === 0 ? right : [width - radius, centerY + radius];
    const bottomRight = radius === 0 ? bottom : [centerX + radius, height - radius];
    const bottomLeft = radius === 0 ? bottom : [centerX - radius, height - radius];
    const leftBottom = radius === 0 ? left : [radius, centerY + radius];
    const leftTop = radius === 0 ? left : [radius, centerY - radius];
    const topLeft = radius === 0 ? top : [centerX - radius, radius];
    const instructions = [
        {
            type: 'M',
            x: topRight[0],
            y: topRight[1],
        },
        edge({
            from: topRight,
            to: rightTop,
            edgeRoundness,
            direction: 'top-right',
        }),
    ];
    if (radius > 0) {
        instructions.push(cap({ from: rightTop, to: rightBottom, radius, direction: 'right' }));
    }
    instructions.push(edge({
        from: rightBottom,
        to: bottomRight,
        edgeRoundness,
        direction: 'right-bottom',
    }));
    if (radius > 0) {
        instructions.push(cap({ from: bottomRight, to: bottomLeft, radius, direction: 'bottom' }));
    }
    instructions.push(edge({
        from: bottomLeft,
        to: leftBottom,
        edgeRoundness,
        direction: 'bottom-left',
    }));
    if (radius > 0) {
        instructions.push(cap({ from: leftBottom, to: leftTop, radius, direction: 'left' }));
    }
    instructions.push(edge({
        from: leftTop,
        to: topLeft,
        edgeRoundness,
        direction: 'left-top',
    }));
    if (radius > 0) {
        instructions.push(cap({ from: topLeft, to: topRight, radius, direction: 'top' }));
    }
    instructions.push({ type: 'Z' });
    return {
        path: (0, paths_1.serializeInstructions)(instructions),
        width,
        height,
        transformOrigin: `${centerX} ${centerY}`,
        instructions,
    };
};
exports.makeSpark = makeSpark;
