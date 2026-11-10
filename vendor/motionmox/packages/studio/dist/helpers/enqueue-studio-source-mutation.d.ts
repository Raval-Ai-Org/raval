import type { ApiRoutes, SourceMutationGuard } from '@motionmox/studio-shared';
export declare const enqueueStudioSourceMutation: <T>(endpoint: keyof ApiRoutes, body: unknown, run: (rebasedBody: unknown, guard: SourceMutationGuard | null) => Promise<T>) => Promise<T>;
