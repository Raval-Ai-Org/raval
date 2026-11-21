import type { ScriptLine } from '@motionmox/studio-shared';
import React from 'react';
export declare const CodeFrame: React.FC<{
    readonly source: ScriptLine[];
    readonly lineNumberWidth: number;
    readonly fontSize: number;
    readonly horizontalMargin: number;
}>;
