import type { CompositionDestination } from '@motionmox/studio-shared';
import { type CompositionRegistrySnapshot } from '../helpers/optimistic-composition-operations';
import { type CompositionSelectorDragData } from './composition-selector-drag-data';
export declare const moveCompositionOrFolder: ({ dragData, destination, destinationFile, getSnapshot, }: {
    readonly dragData: CompositionSelectorDragData;
    readonly destination: CompositionDestination;
    readonly destinationFile: string | null;
    readonly getSnapshot: () => CompositionRegistrySnapshot;
}) => Promise<import("@motionmox/studio-shared").CompositionEditResponse>;
