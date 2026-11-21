import type { Size } from '@motionmox/player';
export declare const applyRulerInsetsToCanvasSize: ({ rulersAreVisible, size, }: {
    readonly rulersAreVisible: boolean;
    readonly size: Size;
}) => Size;
export declare const getRulerCanvasSize: ({ orientation, size, }: {
    readonly orientation: 'horizontal' | 'vertical';
    readonly size: Size;
}) => {
    height: number;
    width: number;
};
