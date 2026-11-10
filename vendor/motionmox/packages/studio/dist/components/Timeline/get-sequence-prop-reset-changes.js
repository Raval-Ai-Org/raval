"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSequencePropResetChanges = void 0;
const studio_shared_1 = require("@motionmox/studio-shared");
const core_1 = require("@motionmox/core");
const isVisibleFieldSchema = (fieldSchema) => fieldSchema !== undefined && fieldSchema.type !== 'hidden';
const getDefaultValue = (fieldSchema) => fieldSchema.default !== undefined
    ? JSON.stringify(fieldSchema.default)
    : null;
const getSequencePropResetChanges = ({ fileName, nodePath, fieldKey, value, defaultValue, schema, }) => {
    const flatSchema = core_1.Internals.getFlatSchemaWithAllKeys(schema);
    const longhandChanges = (0, studio_shared_1.getStylePropertyLonghandKeys)(fieldKey).flatMap((longhandKey) => {
        const fieldSchema = flatSchema[longhandKey];
        if (!isVisibleFieldSchema(fieldSchema)) {
            return [];
        }
        return [
            {
                fileName,
                nodePath,
                fieldKey: longhandKey,
                value: fieldSchema.default,
                defaultValue: getDefaultValue(fieldSchema),
                schema,
            },
        ];
    });
    return [
        { fileName, nodePath, fieldKey, value, defaultValue, schema },
        ...longhandChanges,
    ];
};
exports.getSequencePropResetChanges = getSequencePropResetChanges;
