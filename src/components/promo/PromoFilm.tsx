import type { ReactNode } from "react";
import { DURATION, STAGE, sceneAt, type SceneId } from "@/lib/promo/timeline";
import { C, SceneFrame } from "./parts";
import {
  BrainsScene,
  HookScene,
  PanelsScene,
  RevealScene,
  WebsiteScene,
  type SceneProps,
} from "./scenes-open";
import {
  AllInOneScene,
  AutopilotScene,
  BrainScene,
  ChatScene,
  ConnectScene,
  OutroScene,
  StudioScene,
  VisibilityScene,
} from "./scenes-rest";

/**
 * The 40-second product film, drawn for one moment in time. Presentational:
 * the same `t` always draws the same 1920x1080 picture, which is what lets the
 * recorder capture it frame by frame.
 */
export function PromoFilm({ t, site }: { t: number; site: string }) {
  const time = Math.min(Math.max(t, 0), DURATION);
  const scene = sceneAt(time);
  const props: SceneProps = { lt: time - scene.start, len: scene.end - scene.start };

  const draw: Record<SceneId, () => ReactNode> = {
    hook: () => <HookScene {...props} />,
    reveal: () => <RevealScene {...props} />,
    website: () => <WebsiteScene {...props} />,
    panels: () => <PanelsScene {...props} />,
    brains: () => <BrainsScene {...props} />,
    brain: () => <BrainScene {...props} />,
    studio: () => <StudioScene {...props} />,
    autopilot: () => <AutopilotScene {...props} />,
    visibility: () => <VisibilityScene {...props} />,
    connect: () => <ConnectScene {...props} />,
    chat: () => <ChatScene {...props} />,
    allinone: () => <AllInOneScene {...props} />,
    outro: () => <OutroScene {...props} site={site} />,
  };

  return (
    <div
      data-promo-scene={scene.id}
      style={{
        position: "relative",
        width: STAGE.width,
        height: STAGE.height,
        overflow: "hidden",
        background: `radial-gradient(1200px 700px at 50% 42%, #FFFFFF 0%, ${C.bg} 70%)`,
        color: C.ink,
        fontFamily: "var(--font-sans)",
        fontKerning: "normal",
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <SceneFrame key={scene.id} lt={props.lt} len={props.len} hold={scene.id === "outro"}>
        {draw[scene.id]()}
      </SceneFrame>
    </div>
  );
}
