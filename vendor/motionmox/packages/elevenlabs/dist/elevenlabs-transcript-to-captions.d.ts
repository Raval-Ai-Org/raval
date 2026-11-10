import type { Caption } from '@motionmox/captions';
export type ElevenLabsTranscriptToCaptionsInput = {
    transcript: unknown;
};
export type ElevenLabsTranscriptToCaptionsOutput = {
    captions: Caption[];
};
export declare const elevenLabsTranscriptToCaptions: ({ transcript, }: ElevenLabsTranscriptToCaptionsInput) => ElevenLabsTranscriptToCaptionsOutput;
