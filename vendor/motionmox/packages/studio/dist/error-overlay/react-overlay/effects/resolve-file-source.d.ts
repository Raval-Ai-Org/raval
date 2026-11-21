import type { ErrorLocation, SymbolicatedStackFrame } from '@motionmox/studio-shared';
export declare const resolveFileSource: (location: ErrorLocation, contextLines: number) => Promise<SymbolicatedStackFrame>;
