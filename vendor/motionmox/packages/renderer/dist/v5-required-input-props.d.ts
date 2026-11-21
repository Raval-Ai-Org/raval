import type { NoReactInternals } from '@motionmox/core/no-react';
export type RequiredInputPropsInV5 = typeof NoReactInternals.ENABLE_V5_BREAKING_CHANGES extends true ? {
    inputProps: Record<string, unknown>;
} : {
    inputProps?: Record<string, unknown>;
};
