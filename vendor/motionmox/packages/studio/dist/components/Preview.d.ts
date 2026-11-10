import type { Size } from '@motionmox/player';
import React from 'react';
import type { CanvasContent } from '@motionmox/core';
import type { AssetMetadata } from '../helpers/get-asset-metadata';
import type { Dimensions } from '../helpers/is-current-selected-still';
export declare const VideoPreview: React.FC<{
    readonly canvasSize: Size;
    readonly contentDimensions: Dimensions | 'none' | null;
    readonly canvasContent: CanvasContent;
    readonly assetMetadata: AssetMetadata | null;
    readonly onRetryAssetMetadata?: () => void;
}>;
