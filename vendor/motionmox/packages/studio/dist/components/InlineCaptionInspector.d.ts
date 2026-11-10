import type { Caption } from '@motionmox/captions';
import React from 'react';
import type { SequencePropsSubscriptionKey, SequenceRegistrationControls } from '@motionmox/core';
import type { CodePosition } from '../error-overlay/react-overlay/utils/get-source-map';
export declare const InlineCaptionInspector: React.FC<{
    readonly captions: Caption[];
    readonly controls: SequenceRegistrationControls;
    readonly expanded: boolean;
    readonly getSequenceFrame: () => number;
    readonly nodePath: SequencePropsSubscriptionKey;
    readonly onCaptionsRendered: () => void;
    readonly onInitialCaptionScrollRef: React.RefObject<(() => void) | null>;
    readonly onToggle: () => void;
    readonly readOnlyStudio: boolean;
    readonly validatedLocation: CodePosition;
}>;
