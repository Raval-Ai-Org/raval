import type { File } from '@babel/types';
import type { SequenceNodePath } from '@motionmox/core';
export declare const toImportAgnosticNodePath: ({ ast, nodePath, }: {
    ast: File;
    nodePath: SequenceNodePath;
}) => SequenceNodePath;
export declare const fromImportAgnosticNodePath: ({ ast, nodePath, }: {
    ast: File;
    nodePath: SequenceNodePath;
}) => SequenceNodePath | null;
