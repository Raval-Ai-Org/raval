import React from 'react';
import type { MakeEllipseOptions } from '../utils/make-ellipse';
import type { AllShapesProps } from './render-svg';
export type EllipseProps = MakeEllipseOptions & AllShapesProps;
export declare const Ellipse: React.FC<EllipseProps>;
