import type { SomeStackFrame, SymbolicatedStackFrame } from '@motionmox/studio-shared';
export declare const getFileContents: (fileName: string) => Promise<string>;
export declare const unmap: (frames: SomeStackFrame[], contextLines: number) => Promise<SymbolicatedStackFrame[]>;
