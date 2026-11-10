import type { SequencePropsSubscriptionKey } from '@motionmox/core';
import type { BooleanMap } from './persist-boolean-map';
export declare const migrateExpandedTracksForSubscriptionKey: (prev: BooleanMap, oldKey: SequencePropsSubscriptionKey, newKey: SequencePropsSubscriptionKey) => BooleanMap | null;
