import type { TSequence } from '@motionmox/core';
export declare const shouldSubscribeToSequenceProps: (sequence: TSequence, previewConnected: boolean) => sequence is TSequence & {
    readonly controls: NonNullable<TSequence['controls']>;
};
