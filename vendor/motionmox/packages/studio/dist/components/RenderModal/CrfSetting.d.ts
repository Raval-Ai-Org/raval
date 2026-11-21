import type { Codec } from '@motionmox/renderer';
import type { AvailableOptions } from '@motionmox/renderer/client';
export declare const useCrfState: (codec: Codec, initialCrf: number | null) => {
    crf: number | null;
    setCrf: import("react").Dispatch<import("react").SetStateAction<number>>;
    minCrf: number;
    maxCrf: number;
};
export declare const CrfSetting: React.FC<{
    crf: number;
    setCrf: React.Dispatch<React.SetStateAction<number>>;
    min: number;
    max: number;
    option: AvailableOptions;
}>;
