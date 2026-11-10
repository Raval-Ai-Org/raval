import { type CanUpdateSequencePropsResponse, type InteractivitySchema } from '@motionmox/core';
export declare const optimisticUpdateForEffectPropStatuses: ({ previous, effectIndex, fieldKey, value, schema, }: {
    previous: CanUpdateSequencePropsResponse;
    effectIndex: number;
    fieldKey: string;
    value: unknown;
    schema: InteractivitySchema;
}) => CanUpdateSequencePropsResponse;
