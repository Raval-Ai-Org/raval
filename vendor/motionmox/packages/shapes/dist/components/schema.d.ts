import { type InteractivitySchemaField, type InteractivitySchema } from '@motionmox/core';
export declare const numberField: ({ defaultValue, description, hiddenFromList, integer, max, min, step, }: {
    readonly defaultValue: number | undefined;
    readonly description: string;
    readonly hiddenFromList?: boolean;
    readonly integer?: boolean;
    readonly max?: number;
    readonly min?: number;
    readonly step?: number;
}) => InteractivitySchemaField;
export declare const booleanField: ({ defaultValue, description, }: {
    readonly defaultValue: boolean;
    readonly description: string;
}) => InteractivitySchemaField;
export declare const colorField: ({ defaultValue, description, }: {
    readonly defaultValue: string | undefined;
    readonly description: string;
}) => InteractivitySchemaField;
export declare const enumField: <T extends string>({ defaultValue, description, variants, }: {
    readonly defaultValue: T;
    readonly description: string;
    readonly variants: readonly T[];
}) => InteractivitySchemaField;
export declare const makeShapeSchema: (shapeFields: InteractivitySchema) => InteractivitySchema;
