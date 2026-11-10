import type { LogLevel } from '@motionmox/core';
import type { DrawFn } from '../drawn-fn';
export declare const drawText: ({ span, logLevel, onlyBackgroundClipText, parentRect, }: {
    span: HTMLSpanElement;
    logLevel: LogLevel;
    parentRect: DOMRect;
    onlyBackgroundClipText: boolean;
}) => DrawFn;
