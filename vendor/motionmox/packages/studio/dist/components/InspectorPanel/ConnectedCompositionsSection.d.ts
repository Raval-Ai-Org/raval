import React from 'react';
import type { _InternalTypes } from '@motionmox/core';
import type { TimelineTrackData } from '../../helpers/get-timeline-sequence-sort-key';
export declare const useConnectedCompositions: ({ track, }: {
    readonly track: TimelineTrackData;
}) => import("@motionmox/core").AnyComposition[];
export declare const ConnectedCompositionsSection: React.FC<{
    readonly connectedCompositions: readonly _InternalTypes['AnyComposition'][];
}>;
