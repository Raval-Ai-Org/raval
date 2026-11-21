import { type SequencePropsSubscriptionKey, type TSequence } from '@motionmox/core';
export declare const useSequenceSourceLocation: (sequence: TSequence | null, nodePath: SequencePropsSubscriptionKey | null) => {
    location: import("@motionmox/core").ResolvedStackLocation | null;
    stack: string | null;
};
