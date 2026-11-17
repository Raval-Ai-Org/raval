import type { ReactNode } from "react";
import { easeInOut, lerp, move, progress } from "@/lib/promo/timeline";
import { MOX_DURATION, moxSceneAt, type MoxSceneId } from "@/lib/promo/mox-timeline";
import { H, M, W, type SceneProps } from "./parts";
import { BuiltScene, CreateScene, LearnScene, MeetScene, PressureScene } from "./scenes-a";
import { AlwaysScene, FinaleScene, LoopScene, PayoffScene, PriceScene } from "./scenes-b";

/**
 * The camera per scene: tilt up/down then left/right, in degrees, from the
 * scene's start to its end. Footage scenes stay flat; drawn scenes drift from
 * a high angle to a low one (or back), so no two in a row look alike.
 */
const CAMERA: Record<MoxSceneId, [number, number, number, number]> = {
  built: [4, -2, -5, 3],
  pressure: [-2, 2, 3, -2],
  meet: [0, 0, 0, 0],
  learn: [-3, 3, 5, -4],
  create: [3, -2, -3, 3],
  always: [0, 0, 0, 0],
  loop: [-3, 2, -4, 4],
  payoff: [4, -3, 3, -3],
  price: [-3, 2, -3, 3],
  finale: [0, 0, 0, 0],
};

/**
 * The 107-second "Meet Mox" film, drawn for one moment in time. Presentational:
 * the same `t` always draws the same 1920x1080 picture, which is what lets the
 * recorder capture it frame by frame.
 */
export function MoxFilm({ t, site }: { t: number; site: string }) {
  const time = Math.min(Math.max(t, 0), MOX_DURATION);
  const scene = moxSceneAt(time);
  const props: SceneProps = { lt: time - scene.start, len: scene.end - scene.start };

  const draw: Record<MoxSceneId, () => ReactNode> = {
    built: () => <BuiltScene {...props} />,
    pressure: () => <PressureScene {...props} />,
    meet: () => <MeetScene {...props} />,
    learn: () => <LearnScene {...props} />,
    create: () => <CreateScene {...props} />,
    always: () => <AlwaysScene {...props} />,
    loop: () => <LoopScene {...props} />,
    payoff: () => <PayoffScene {...props} />,
    price: () => <PriceScene {...props} />,
    finale: () => <FinaleScene {...props} site={site} />,
  };

  // Each scene clears in and softens out; the last one holds.
  const enter = move(props.lt, 0, 0.35);
  const leave = scene.id === "finale" ? 0 : progress(props.lt, props.len - 0.28, 0.28);
  const blur = (1 - enter) * 14 + leave * 12;
  const through = easeInOut(progress(props.lt, 0, props.len));
  const [tiltFrom, tiltTo, panFrom, panTo] = CAMERA[scene.id];
  const tilted = tiltFrom !== 0 || panFrom !== 0;

  return (
    <div
      data-promo-scene={scene.id}
      style={{
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        perspective: 2600,
        background: M.white,
        color: M.ink,
        fontFamily: "var(--font-sans)",
        // Unitless, so big type never inherits the app's fixed body line height.
        lineHeight: 1.15,
        fontKerning: "normal",
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div
        key={scene.id}
        style={{
          position: "absolute",
          inset: 0,
          opacity: enter * (1 - leave),
          filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
          transform: `scale(${((tilted ? 1.05 : 1.025) - enter * 0.025 + leave * 0.025 + progress(props.lt, 0, props.len) * 0.022).toFixed(4)}) rotateX(${lerp(tiltFrom, tiltTo, through).toFixed(3)}deg) rotateY(${lerp(panFrom, panTo, through).toFixed(3)}deg)`,
        }}
      >
        {draw[scene.id]()}
      </div>
    </div>
  );
}
