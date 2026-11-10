import type { Instruction } from '@motionmox/paths';
export type ShapeInfo = {
    path: string;
    width: number;
    height: number;
    transformOrigin: string;
    instructions: Instruction[];
};
