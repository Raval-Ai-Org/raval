import React from 'react';
import { type TSequence } from '@motionmox/core';
import type { SequenceNodePathInfo } from '../../helpers/get-timeline-sequence-sort-key';
export declare const SequenceUnwrapAction: React.FC<{
    readonly nodePathInfo: SequenceNodePathInfo;
    readonly sequence: TSequence;
    readonly sourceActionsDisabled: boolean;
    readonly sourceLocation: {
        readonly source: string;
        readonly line: number;
    };
}>;
