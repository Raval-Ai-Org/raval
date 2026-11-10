import type { CSSProperties } from 'react';
import type { TransitionPresentation } from '../types.js';
export type PushCutProps = {
    cutProgress?: number;
    outgoingScale?: number;
    incomingStartScale?: number;
    incomingEndScale?: number;
    transformOrigin?: CSSProperties['transformOrigin'];
    flashColor?: string;
    flashOpacity?: number;
    flashFrames?: number;
    outerEnterStyle?: CSSProperties;
    outerExitStyle?: CSSProperties;
    innerEnterStyle?: CSSProperties;
    innerExitStyle?: CSSProperties;
};
export declare const pushCut: (props?: PushCutProps) => TransitionPresentation<PushCutProps>;
