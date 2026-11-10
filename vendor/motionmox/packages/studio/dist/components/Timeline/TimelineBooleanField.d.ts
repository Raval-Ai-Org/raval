import React from 'react';
import type { CanUpdateSequencePropStatusStatic } from '@motionmox/core';
import type { SchemaFieldInfo, TimelineFieldOnSave } from '../../helpers/timeline-layout';
export declare const TimelineBooleanField: React.FC<{
    readonly field: SchemaFieldInfo;
    readonly propStatus: CanUpdateSequencePropStatusStatic;
    readonly effectiveValue: unknown;
    readonly onSave: TimelineFieldOnSave;
}>;
