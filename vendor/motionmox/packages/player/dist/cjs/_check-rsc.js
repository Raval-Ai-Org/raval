"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
if (typeof react_1.createContext !== 'function') {
    const err = [
        'MotionMox requires React.createContext, but it is "undefined".',
        'If you are in a React Server Component, turn it into a client component by adding "use client" at the top of the file.',
        '',
        'Before:',
        '  import {Player} from "@motionmox/player";',
        '',
        'After:',
        '  "use client";',
        '  import {Player} from "@motionmox/player";',
    ];
    throw new Error(err.join('\n'));
}
