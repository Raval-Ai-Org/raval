import React from 'react';
import type { MakePieProps } from '../utils/make-pie';
import type { AllShapesProps } from './render-svg';
export type PieProps = MakePieProps & AllShapesProps;
export declare const Pie: React.FC<PieProps>;
