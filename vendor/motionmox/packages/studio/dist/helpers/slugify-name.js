"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyName = void 0;
const core_1 = require("@motionmox/core");
const slugifyName = (name) => {
    return core_1.Internals.isFolderNameValid(name)
        ? name
        : name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9\u4E00-\u9FFF-]+/g, '-')
            .replace(/^-+|-+$/g, '');
};
exports.slugifyName = slugifyName;
