import type { RenameStaticFileResponse } from '@motionmox/studio-shared';
export declare const renameStaticFile: ({ oldRelativePath, newRelativePath, }: {
    oldRelativePath: string;
    newRelativePath: string;
}) => Promise<RenameStaticFileResponse>;
export { RenameStaticFileResponse };
