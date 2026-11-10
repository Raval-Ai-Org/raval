import React from 'react';
import type { TSequence } from '@motionmox/core';
export type TimelineSequenceObserver = (sequences: TSequence[]) => void;
export declare const TimelineSequenceObserverContext: React.Context<TimelineSequenceObserver | null>;
