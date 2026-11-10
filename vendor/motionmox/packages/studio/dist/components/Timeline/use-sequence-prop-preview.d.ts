export declare const useSequencePropPreview: () => {
    getPreview: () => {
        getNodePath: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey) => import("@motionmox/core").SequencePropsSubscriptionKey | null;
        isLatest: () => boolean;
        setDragOverrides: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey, key: string, value: import("@motionmox/core").DragOverrideValue) => void;
        setDragOverridesBatch: (values: readonly {
            nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            key: string;
            value: import("@motionmox/core").DragOverrideValue;
        }[], updateBatch: (updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
        }[]) => void) => void;
        setEffectDragOverridesBatch: (values: readonly {
            nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            effectIndex: number;
            key: string;
            value: import("@motionmox/core").DragOverrideValue;
        }[], updateBatch: (updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly effectIndex: number;
            readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
        }[]) => void) => void;
        setPropStatuses: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey, apply: (prev: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse) => void;
        setPropStatusesBatch: (updates: Parameters<(updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly update: (previous: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse;
        }[]) => void>[0]) => void;
        cancel: () => void;
        fail: () => void;
        acknowledgeKeyframes: (results: readonly import("@motionmox/studio-shared").KeyframeMutationResult[]) => void;
        acknowledge: (response: import("@motionmox/studio-shared").SaveSequencePropsResponse | null) => void;
    };
    takePreview: () => {
        getNodePath: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey) => import("@motionmox/core").SequencePropsSubscriptionKey | null;
        isLatest: () => boolean;
        setDragOverrides: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey, key: string, value: import("@motionmox/core").DragOverrideValue) => void;
        setDragOverridesBatch: (values: readonly {
            nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            key: string;
            value: import("@motionmox/core").DragOverrideValue;
        }[], updateBatch: (updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
        }[]) => void) => void;
        setEffectDragOverridesBatch: (values: readonly {
            nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            effectIndex: number;
            key: string;
            value: import("@motionmox/core").DragOverrideValue;
        }[], updateBatch: (updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly effectIndex: number;
            readonly update: (current: Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>) => Readonly<Record<string, import("@motionmox/core").DragOverrideValue>>;
        }[]) => void) => void;
        setPropStatuses: (nodePath: import("@motionmox/core").SequencePropsSubscriptionKey, apply: (prev: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse) => void;
        setPropStatusesBatch: (updates: Parameters<(updates: readonly {
            readonly nodePath: import("@motionmox/core").SequencePropsSubscriptionKey;
            readonly update: (previous: import("@motionmox/core").CanUpdateSequencePropsResponse) => import("@motionmox/core").CanUpdateSequencePropsResponse;
        }[]) => void>[0]) => void;
        cancel: () => void;
        fail: () => void;
        acknowledgeKeyframes: (results: readonly import("@motionmox/studio-shared").KeyframeMutationResult[]) => void;
        acknowledge: (response: import("@motionmox/studio-shared").SaveSequencePropsResponse | null) => void;
    };
    cancelPreview: () => void;
};
