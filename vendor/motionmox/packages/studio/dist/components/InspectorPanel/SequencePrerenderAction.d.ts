import React from 'react';
import type { _InternalTypes, TSequence } from '@motionmox/core';
import type { SequenceNodePathInfo } from '../../helpers/get-timeline-sequence-sort-key';
export declare const SequencePrerenderAction: React.FC<{
    readonly nodePathInfo: SequenceNodePathInfo;
    readonly sequence: TSequence;
    readonly connectedComposition: _InternalTypes['AnyComposition'];
    readonly sourceActionsDisabled: boolean;
}>;
