import type { SymbolicatedStackFrame } from '@motionmox/studio-shared';
import type { _InternalTypes } from '@motionmox/core';
export declare const useRenameComposition: ({ compositions, currentId, newId, }: {
    compositions: _InternalTypes['AnyComposition'][];
    currentId: string;
    newId: string;
}) => {
    compositionId: string;
    getValidationMessage: (value: string) => string | null;
    renameComposition: ({ newCompositionId, signal, symbolicatedStack, }: {
        newCompositionId: string;
        signal: AbortSignal;
        symbolicatedStack: SymbolicatedStackFrame | null;
    }) => Promise<import("@motionmox/studio-shared").CompositionEditResponse>;
    valid: boolean;
    validationMessage: string | null;
};
