import type { StaticFile } from '@motionmox/core';
declare const collectFiles: ({ folder, output, startPath, staticHash, limit, }: {
    folder: string;
    startPath: string;
    output?: StaticFile[];
    staticHash: string;
    limit: number;
}) => StaticFile[];
export declare const readRecursively: (options: Parameters<typeof collectFiles>[0]) => StaticFile[];
export {};
