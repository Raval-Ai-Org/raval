export type TransitionSeriesChildKind = 'sequence' | 'connector' | 'other';
export declare const findDanglingConnectors: ({ kinds, deleted, }: {
    kinds: readonly TransitionSeriesChildKind[];
    deleted: readonly boolean[];
}) => number[];
