import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import type { AbsoluteFillLayout, LayoutAndStyle, SequenceProps, SequencePropsWithoutDuration } from '@motionmox/core';
import { NoReactInternals } from '@motionmox/core/no-react';
import type { TransitionSeriesOverlayProps, TransitionSeriesTransitionProps } from './types.js';
type TransitionSeriesTransitionComponent = <PresentationProps extends Record<string, unknown>>(props: TransitionSeriesTransitionProps<PresentationProps>) => React.ReactNode;
declare const TransitionSeriesTransition: TransitionSeriesTransitionComponent;
declare const SeriesOverlay: FC<TransitionSeriesOverlayProps>;
type LayoutBasedProps = true extends typeof NoReactInternals.ENABLE_V5_BREAKING_CHANGES ? AbsoluteFillLayout : LayoutAndStyle;
type SeriesSequenceProps = PropsWithChildren<{
    readonly durationInFrames: number;
    readonly offset?: number;
    readonly className?: string;
} & LayoutBasedProps & Omit<SequencePropsWithoutDuration, 'from' | 'loop' | `_remotionInternal${string}` | keyof AbsoluteFillLayout>>;
declare const SeriesSequence: FC<SeriesSequenceProps>;
export type DrawFunction = (prevImage: OffscreenCanvas | null, nextImage: OffscreenCanvas | null, progress: number) => void;
declare const TransitionSeries: FC<SequenceProps> & {
    Sequence: typeof SeriesSequence;
    Transition: typeof TransitionSeriesTransition;
    Overlay: typeof SeriesOverlay;
};
export { TransitionSeries };
