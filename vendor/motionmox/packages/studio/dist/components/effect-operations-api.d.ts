import type { AddEffectRequest, DeleteEffectRequest, DuplicateEffectRequest, PasteEffectsRequest, ReorderEffectRequest, SaveEffectPropsRequest, SaveMultipleEffectPropsRequest } from '@motionmox/studio-shared';
export declare const addEffect: (request: AddEffectRequest) => Promise<import("@motionmox/studio-shared").AddEffectResponse>;
export declare const deleteEffects: (request: DeleteEffectRequest) => Promise<import("@motionmox/studio-shared").DeleteEffectResponse>;
export declare const duplicateEffects: (request: DuplicateEffectRequest) => Promise<import("@motionmox/studio-shared").DuplicateEffectResponse>;
export declare const pasteEffects: (request: PasteEffectsRequest) => Promise<import("@motionmox/studio-shared").PasteEffectsResponse>;
export declare const reorderEffect: (request: ReorderEffectRequest) => Promise<import("@motionmox/studio-shared").ReorderEffectResponse>;
export declare const saveEffectProps: (request: SaveEffectPropsRequest) => Promise<import("@motionmox/studio-shared").SaveEffectPropsResponse>;
export declare const saveMultipleEffectProps: (request: SaveMultipleEffectPropsRequest) => Promise<import("@motionmox/studio-shared").SaveMultipleEffectPropsResponse>;
