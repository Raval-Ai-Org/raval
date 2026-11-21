import type { SequencePropsSubscriptionKey } from '@motionmox/core';
import type { SchemaFieldInfo } from '../../helpers/timeline-layout';
export declare const usePlaybackRatePreview: ({ field, nodePath, }: {
    readonly field: SchemaFieldInfo;
    readonly nodePath: SequencePropsSubscriptionKey;
}) => {
    preview: (value: unknown) => void;
    take: (value: unknown) => {
        preview: {
            getNodePath: (nodePath: SequencePropsSubscriptionKey) => SequencePropsSubscriptionKey | null;
            isLatest: () => boolean;
            setDragOverrides: (nodePath: SequencePropsSubscriptionKey, key: string, value: import("@motionmox/core").DragOverrideValue) => void;
            setDragOverridesBatch: (values: readonly {
                nodePath: SequencePropsSubscriptionKey;
                key: string;
                value: import("@motionmox/core").DragOverrideValue;
            }[], updateBatch: (updates: readonly {
                readonly nodePath: SequencePropsSubscriptionKey;
                readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
            }[]) => void) => void;
            setEffectDragOverridesBatch: (values: readonly {
                nodePath: SequencePropsSubscriptionKey;
                effectIndex: number;
                key: string;
                value: import("@motionmox/core").DragOverrideValue;
            }[], updateBatch: (updates: readonly {
                readonly nodePath: SequencePropsSubscriptionKey;
                readonly effectIndex: number;
                readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
            }[]) => void) => void;
            setPropStatuses: (nodePath: SequencePropsSubscriptionKey, apply: (prev: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse) => void;
            setPropStatusesBatch: (updates: Parameters<(updates: readonly {
                readonly nodePath: SequencePropsSubscriptionKey;
                readonly update: (previous: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse;
            }[]) => void>[0]) => void;
            cancel: () => void;
            fail: () => void;
            acknowledgeKeyframes: (results: readonly import("@motionmox/studio-shared").KeyframeMutationResult[]) => void;
            acknowledge: (response: import("@motionmox/studio-shared").SaveSequencePropsResponse | null) => void;
        };
        commit: () => void;
    } | null;
    cancel: () => void;
};
