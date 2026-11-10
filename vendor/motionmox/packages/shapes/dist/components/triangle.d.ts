import React from 'react';
import type { MakeTriangleProps } from '../utils/make-triangle';
import type { AllShapesProps } from './render-svg';
export type TriangleProps = MakeTriangleProps & AllShapesProps;
export declare const Triangle: React.FC<TriangleProps>;
