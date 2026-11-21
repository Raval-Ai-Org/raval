import type { SubscribeToDefaultPropsRequest, SubscribeToDefaultPropsResponse, UnsubscribeFromDefaultPropsRequest } from '@motionmox/studio-shared';
export declare const subscribeToDefaultProps: (request: SubscribeToDefaultPropsRequest) => Promise<SubscribeToDefaultPropsResponse>;
export declare const unsubscribeFromDefaultProps: (request: UnsubscribeFromDefaultPropsRequest) => Promise<undefined>;
