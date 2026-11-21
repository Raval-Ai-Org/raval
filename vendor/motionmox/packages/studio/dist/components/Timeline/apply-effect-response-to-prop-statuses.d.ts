import type { CanUpdateEffectPropsResponse, CanUpdateSequencePropsResponse } from '@motionmox/core';
export declare const applyEffectResponseToPropStatuses: ({ previous, response, }: {
    previous: CanUpdateSequencePropsResponse;
    response: CanUpdateEffectPropsResponse;
}) => CanUpdateSequencePropsResponse;
