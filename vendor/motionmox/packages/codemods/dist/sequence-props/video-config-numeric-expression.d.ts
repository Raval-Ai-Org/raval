import type { Expression } from '@babel/types';
import type { ExpressionKind } from 'ast-types/lib/gen/kinds';
import type { VideoConfigNumericExpression } from '@motionmox/core';
import type { VideoConfigIdentifierValues } from './video-config-values';
export declare const parseVideoConfigNumericExpression: ({ node, videoConfigValues, }: {
    node: Expression;
    videoConfigValues: VideoConfigIdentifierValues;
}) => VideoConfigNumericExpression | null;
export declare const updateVideoConfigNumericExpression: ({ expression, value, }: {
    expression: VideoConfigNumericExpression;
    value: number;
}) => ExpressionKind;
