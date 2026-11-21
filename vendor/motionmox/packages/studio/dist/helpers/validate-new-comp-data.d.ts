import type { _InternalTypes } from '@motionmox/core';
export declare const validateCompositionName: (compName: string, compositions: _InternalTypes['AnyComposition'][]) => string | null;
export declare const validateCompositionDimension: (dimension: 'Width' | 'Height', value: number) => string | null;
export declare const validateCompositionDuration: (value: number) => string | null;
