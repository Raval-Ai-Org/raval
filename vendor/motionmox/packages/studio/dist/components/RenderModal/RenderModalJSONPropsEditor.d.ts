import React from 'react';
import type { SerializedJSONWithCustomFields } from '@motionmox/core';
import type { AnyZodSchema } from './SchemaEditor/zod-schema-type';
export declare const RenderModalJSONPropsEditor: React.FC<{
    readonly value: unknown;
    readonly setValue: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
    readonly onSave: () => void;
    readonly serializedJSON: SerializedJSONWithCustomFields | null;
    readonly defaultProps: Record<string, unknown>;
    readonly schema: AnyZodSchema;
    readonly compositionId: string;
    readonly layout?: 'default' | 'inspector';
}>;
