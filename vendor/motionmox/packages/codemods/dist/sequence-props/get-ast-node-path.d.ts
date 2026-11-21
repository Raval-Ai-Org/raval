import type { File } from '@babel/types';
import type { NodePath } from 'ast-types';
import type { SequenceNodePath } from '@motionmox/core';
export declare const getAstNodePath: (ast: File, nodePath: SequenceNodePath) => NodePath | null;
