"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetCompositionComponent = void 0;
const assetCompositionComponent = ({ asset, componentName, }) => {
    const tag = asset.type === 'image'
        ? 'CanvasImage'
        : asset.type === 'video'
            ? 'Video'
            : 'Audio';
    const imports = asset.type === 'image'
        ? "import {CanvasImage, staticFile} from '@motionmox/core';"
        : `import {${tag}} from '@motionmox/media';\nimport {staticFile} from '@motionmox/core';`;
    return `import React from 'react';
${imports}

export const ${componentName}: React.FC = () => {
	return (
		<${tag}
			src={staticFile(${JSON.stringify(asset.src)})}
			durationInFrames={${asset.durationInFrames}}
		/>
	);
};
`;
};
exports.assetCompositionComponent = assetCompositionComponent;
