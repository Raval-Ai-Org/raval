import { type MoveKeyframesResponse } from '@motionmox/studio-shared';
import type { InteractivitySchema, SequencePropsSubscriptionKey } from '@motionmox/core';
import type { SetPropStatuses } from './save-sequence-prop';
export type MoveSequenceKeyframeChange = {
    fileName: string;
    nodePath: SequencePropsSubscriptionKey;
    fieldKey: string;
    fromFrame: number;
    toFrame: number;
    schema: InteractivitySchema;
    keyframeDisplayOffsetAdjustmentDelta?: number;
};
export type MoveEffectKeyframeChange = MoveSequenceKeyframeChange & {
    effectIndex: number;
};
export declare const applyOptimisticKeyframeMoves: ({ sequenceKeyframes, effectKeyframes, setPropStatuses, }: {
    sequenceKeyframes: MoveSequenceKeyframeChange[];
    effectKeyframes: MoveEffectKeyframeChange[];
    setPropStatuses: SetPropStatuses;
}) => {
    optimistic: boolean;
    acknowledge: () => void;
    restore: (direction: 'undo' | 'redo') => {
        acknowledge: () => void;
        rollback: () => void;
    };
    applyOptimistic: (previous: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse;
    applyResponse: (previous: import("@motionmox/core").CanUpdateSequencePropsResponse, response: import("@motionmox/core").CanUpdateEffectPropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse;
    rollback: () => void;
}[];
export declare const callMoveKeyframes: ({ sequenceKeyframes, effectKeyframes, setPropStatuses, setPropStatusesBatch, clientId, }: {
    sequenceKeyframes: MoveSequenceKeyframeChange[];
    effectKeyframes: MoveEffectKeyframeChange[];
    setPropStatuses: SetPropStatuses;
    setPropStatusesBatch: ((updates: readonly {
        nodePath: SequencePropsSubscriptionKey;
        update: Parameters<SetPropStatuses>[1];
    }[]) => void) | null;
    clientId: string;
}) => Promise<MoveKeyframesResponse>;
