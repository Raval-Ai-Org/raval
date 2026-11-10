"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateNewFolderName = void 0;
const core_1 = require("@motionmox/core");
const validateNewFolderName = ({ folders, newName, parentName, }) => {
    if (!core_1.Internals.isFolderNameValid(newName)) {
        return core_1.Internals.invalidFolderNameErrorMessage;
    }
    if (folders.find((folder) => {
        return folder.name === newName && folder.parent === parentName;
    })) {
        return `A folder with that name already exists.`;
    }
    return null;
};
exports.validateNewFolderName = validateNewFolderName;
