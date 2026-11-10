import type { SequencePropsSubscriptionKey } from '@motionmox/core';
export declare const stringifySequenceSubscriptionKey: (key: Omit<SequencePropsSubscriptionKey, 'videoConfigValues'>) => string;
export declare const stringifySequenceExpandedRowKey: (key: Omit<SequencePropsSubscriptionKey, 'videoConfigValues'>) => string;
