import React from 'react';
import type { MakeHeartProps } from '../utils/make-heart';
import type { AllShapesProps } from './render-svg';
export type HeartProps = MakeHeartProps & AllShapesProps;
export declare const Heart: React.FC<HeartProps>;
