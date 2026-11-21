import type { TransitionPresentation } from '../types.js';
export type CubeDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
export type CubeProps = {
    direction: CubeDirection;
    perspective?: number;
};
/**
 * @description Rotates the entering and exiting scenes as faces of a 3D cube.
 * @see [Documentation](https://www.remotion.dev/docs/transitions/presentations/cube)
 */
export declare const cube: (props: CubeProps) => TransitionPresentation<CubeProps>;
