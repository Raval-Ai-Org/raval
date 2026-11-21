import type { Codec } from '@motionmox/renderer';
import type { RenderType } from '../components/RenderModal/RenderModalAdvanced';
type Section = 'general' | 'data' | 'picture' | 'audio' | 'gif' | 'encoding' | 'environment' | 'advanced';
export declare const useRenderModalSections: (renderMode: RenderType, codec: Codec) => {
    tab: Section;
    setTab: import("react").Dispatch<import("react").SetStateAction<Section>>;
    shownTabs: Section[];
};
export {};
