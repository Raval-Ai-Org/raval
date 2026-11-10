import type { ScheduleAudioNodeOptions, ScheduleAudioNodeResult } from '@motionmox/core';
export type SharedAudioContextForMediaPlayer = {
    audioContext: AudioContext;
    gainNode: GainNode;
    audioSyncAnchor: {
        value: number;
    };
    scheduleAudioNode: (options: ScheduleAudioNodeOptions) => ScheduleAudioNodeResult;
    unscheduleAudioNode: (node: AudioBufferSourceNode) => boolean | void;
};
