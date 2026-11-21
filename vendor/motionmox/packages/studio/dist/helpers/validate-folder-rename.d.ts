import type { _InternalTypes } from '@motionmox/core';
export declare const validateFolderRename: ({ folders, newName, originalName, parentName, }: {
    folders: _InternalTypes['TFolder'][];
    newName: string;
    originalName: string;
    parentName: string | null;
}) => string | null;
