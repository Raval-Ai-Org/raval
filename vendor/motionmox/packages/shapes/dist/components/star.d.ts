import React from 'react';
import type { MakeStarProps } from '../utils/make-star';
import type { AllShapesProps } from './render-svg';
export type StarProps = MakeStarProps & Omit<AllShapesProps, 'points'>;
export declare const Star: React.FC<StarProps>;
