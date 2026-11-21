import type { Caption } from '@motionmox/captions';
import React from 'react';
export declare const CaptionTextEditor: React.FC<{
    readonly captions: Caption[];
    readonly onChange: (captions: Caption[]) => void;
    readonly onSave: ((captions: Caption[]) => void) | null;
    readonly onCancel: (() => void) | null;
    readonly readOnly: boolean;
}>;
