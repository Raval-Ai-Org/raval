import type { SequencePropsSubscriptionKey } from '@motionmox/core';
import { type SetPropStatuses } from './save-sequence-prop';
export declare const disableSequenceInteractivity: ({ clientId, fileName, nodePath, setPropStatuses, }: {
    readonly clientId: string;
    readonly fileName: string;
    readonly nodePath: SequencePropsSubscriptionKey;
    readonly setPropStatuses: SetPropStatuses;
}) => Promise<void>;
