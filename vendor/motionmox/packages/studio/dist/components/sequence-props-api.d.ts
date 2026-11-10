import type { SaveSequencePropsRequest, SaveSequencePropsResponse, SubscribeToSequencePropsRequest, SubscribeToSequencePropsResponse, UnsubscribeFromSequencePropsRequest } from '@motionmox/studio-shared';
export declare const saveSequenceProps: (request: SaveSequencePropsRequest) => Promise<SaveSequencePropsResponse>;
export declare const subscribeToSequenceProps: (request: SubscribeToSequencePropsRequest, stack: string | null) => Promise<SubscribeToSequencePropsResponse>;
export declare const unsubscribeFromSequenceProps: (request: UnsubscribeFromSequencePropsRequest) => Promise<undefined>;
