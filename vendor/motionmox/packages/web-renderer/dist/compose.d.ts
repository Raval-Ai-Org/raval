import type { LogLevel } from '@motionmox/core';
import type { InternalState } from './internal-state';
export declare const compose: ({ element, context, logLevel, parentRect, internalState, onlyBackgroundClipText, scale, waitForPageResponsiveness, }: {
    element: HTMLElement | SVGElement;
    context: OffscreenCanvasRenderingContext2D;
    logLevel: LogLevel;
    parentRect: DOMRect;
    internalState: InternalState;
    onlyBackgroundClipText: boolean;
    scale: number;
    waitForPageResponsiveness: (() => Promise<void>) | null;
}) => Promise<void>;
