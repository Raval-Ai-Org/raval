import type { Caption } from '@motionmox/captions';
export type OpenAiToCaptionsInput = {
    transcription: unknown;
};
export type OpenAiToCaptionsOutput = {
    captions: Caption[];
};
export declare const openAiWhisperApiToCaptions: ({ transcription, }: OpenAiToCaptionsInput) => OpenAiToCaptionsOutput;
