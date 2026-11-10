import type { PreferredEffectBackend } from '@motionmox/core';
export declare const preferredEffectBackendOption: {
    name: string;
    addedIn: string;
    cliFlag: "preferred-effect-backend";
    id: "preferred-effect-backend";
    ssrName: string;
    docLink: string;
    type: PreferredEffectBackend;
    description: () => import("react").JSX.Element;
    getValue: ({ commandLine }: {
        commandLine: Record<string, unknown>;
    }) => {
        value: PreferredEffectBackend;
        source: string;
    };
    setConfig: (value: PreferredEffectBackend) => void;
};
