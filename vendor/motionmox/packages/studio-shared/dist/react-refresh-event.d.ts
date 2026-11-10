import { Internals } from '@motionmox/core';
declare global {
    interface Window {
        remotion_performReactRefresh: (() => unknown) | null;
    }
}
export declare const { REACT_REFRESH_STARTED_EVENT, REACT_REFRESH_FINISHED_EVENT, }: typeof Internals;
