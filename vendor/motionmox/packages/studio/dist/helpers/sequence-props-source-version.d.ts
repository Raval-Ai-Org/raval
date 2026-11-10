import type { SourceFileVersion } from '@motionmox/studio-shared';
import type { ContextType } from 'react';
import type { SequencePropsSubscriptionKey } from '@motionmox/core';
import { Internals } from '@motionmox/core';
type Setters = ContextType<typeof Internals.VisualModeSettersContext>;
export declare const getSequencePropsSourceSession: () => string | null;
export declare const setSequencePropsSourceSession: (sessionId: string | null) => void;
export declare const acceptSequencePropsSourceVersion: (updateDragOverrides: Setters['updateDragOverrides'], nodePath: SequencePropsSubscriptionKey, version: SourceFileVersion | null) => boolean;
export {};
