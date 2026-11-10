import type { DefaultCodingAgent } from '@motionmox/renderer';
import type { EditorPickerId } from '@motionmox/studio-shared';
import type { SequencePropsSubscriptionKey, TSequence } from '@motionmox/core';
export declare const useOpenSequenceInApps: (sequence: TSequence, nodePath: SequencePropsSubscriptionKey | null) => {
    canOpenSource: boolean;
    canOpenInEditor: boolean;
    canConfigureApps: boolean;
    codingAgentInfo: import("@motionmox/studio-shared").GetDefaultCodingAgentInfoResponse | null;
    editorInfo: import("@motionmox/studio-shared").GetDefaultEditorInfoResponse | null;
    openInCodingAgent: (codingAgentId: DefaultCodingAgent, codingAgentName: string, contextForAgents: string | null) => Promise<void>;
    openInEditor: (editorId: EditorPickerId | null) => Promise<void>;
    openSource: () => void;
    originalLocation: import("@motionmox/core").ResolvedStackLocation | null;
};
