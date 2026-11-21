import { type CanUpdateSequencePropsResponse, type InteractivitySchema } from '@motionmox/core';
export declare const optimisticUpdateForPropStatuses: ({ previous, fieldKey, value, defaultValue, schema, }: {
    previous: CanUpdateSequencePropsResponse;
    fieldKey: string;
    value: unknown;
    defaultValue?: string | null;
    schema: InteractivitySchema;
}) => CanUpdateSequencePropsResponse;
