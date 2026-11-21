// The bundle's compositions. One composition, sized and timed by its spec.
import { Composition } from "@motionmox/core";
import { MotionMoxVideo, type MotionMoxProps } from "./MotionMoxVideo";
import { MOTIONMOX_COMPOSITION_ID, MOTIONMOX_FPS, specFrames } from "../spec";
import { SAMPLE_SPEC } from "./sample";

export function MotionMoxRoot() {
  return (
    <Composition
      id={MOTIONMOX_COMPOSITION_ID}
      component={MotionMoxVideo}
      fps={MOTIONMOX_FPS}
      width={SAMPLE_SPEC.width}
      height={SAMPLE_SPEC.height}
      durationInFrames={specFrames(SAMPLE_SPEC)}
      defaultProps={{ spec: SAMPLE_SPEC, baseUrl: "" } satisfies MotionMoxProps}
      calculateMetadata={({ props }) => ({
        width: props.spec.width,
        height: props.spec.height,
        fps: props.spec.fps,
        durationInFrames: specFrames(props.spec),
      })}
    />
  );
}
