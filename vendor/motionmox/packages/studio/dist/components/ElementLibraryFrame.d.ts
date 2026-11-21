import { type StudioCaptionStyleSelection } from '@motionmox/studio-protocol';
import React from 'react';
export declare const ElementLibraryFrame: React.FC<{
    readonly name: string;
    readonly url: string;
    readonly context: 'captions' | null;
    readonly captionStyleSelection: StudioCaptionStyleSelection;
}>;
