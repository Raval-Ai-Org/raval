import type { File, Identifier } from '@babel/types';
import { type KeyframeInterpolationFunction } from '@motionmox/studio-shared/keyframe-interpolation-function';
export declare const getKeyframeInterpolationFunctionForCallee: ({ ast, callee, }: {
    ast: File;
    callee: Identifier;
}) => KeyframeInterpolationFunction | null;
