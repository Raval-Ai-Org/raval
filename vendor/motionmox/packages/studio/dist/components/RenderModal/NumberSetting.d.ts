import type { AvailableOptions } from '@motionmox/renderer/client';
import React from 'react';
type NumberSettingHint = AvailableOptions | {
    readonly content: React.ReactNode;
    readonly title: string;
};
export declare const NumberSetting: React.FC<{
    readonly name: string;
    readonly value: number;
    readonly onValueChanged: React.Dispatch<React.SetStateAction<number>>;
    readonly max?: number;
    readonly min: number;
    readonly step: number;
    readonly formatter?: (value: string | number) => string;
    readonly hint?: NumberSettingHint;
}>;
export {};
