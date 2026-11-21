import type { SymbolicatedStackFrame } from '@motionmox/studio-shared';
import type { ResolvedStackLocation } from '@motionmox/core';
export declare const resolvedStackToSymbolicated: (location: ResolvedStackLocation | null) => SymbolicatedStackFrame | null;
