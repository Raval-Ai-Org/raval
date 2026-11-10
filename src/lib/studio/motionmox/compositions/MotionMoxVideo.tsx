// The one MotionMox composition Mellox renders: the person's own clips or
// photos, joined with a transition, with the planned elements animated on top.
// It only draws what the grounded spec says. Inline styles, no outside
// addresses: every file comes from the render's own loopback server.
// Relative imports only (this file is bundled by @motionmox/bundler too).
import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "@motionmox/core";
import {
  TransitionSeries,
  linearTiming,
  type TransitionPresentation,
} from "@motionmox/transitions";
import { fade } from "@motionmox/transitions/fade";
import { slide } from "@motionmox/transitions/slide";
import { wipe } from "@motionmox/transitions/wipe";
import { MOTIONMOX_ELEMENTS, visibility } from "../elements";
import type { MotionMoxSegment, MotionMoxSpec, MotionMoxText } from "../spec";

export type MotionMoxProps = {
  spec: MotionMoxSpec;
  /** Where the render's files are served (the loopback server), or "" in the lab, where src are full URLs. */
  baseUrl: string;
};

const url = (base: string, src: string) => (base ? `${base.replace(/\/$/, "")}/${src}` : src);

/** One presentation type for all three, so TransitionSeries takes any of them. */
type AnyPresentation = TransitionPresentation<Record<string, unknown>>;

function presentation(spec: MotionMoxSpec): AnyPresentation {
  switch (spec.transition) {
    case "slide-left":
      return slide({ direction: "from-right" }) as unknown as AnyPresentation;
    case "slide-up":
      return slide({ direction: "from-bottom" }) as unknown as AnyPresentation;
    case "wipe":
      return wipe({ direction: "from-left" }) as unknown as AnyPresentation;
    default:
      return fade() as unknown as AnyPresentation;
  }
}

function Segment({ segment, baseUrl }: { segment: MotionMoxSegment; baseUrl: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fill: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  if (segment.kind === "video")
    return (
      <AbsoluteFill style={{ backgroundColor: "#000" }}>
        <OffthreadVideo
          src={url(baseUrl, segment.src)}
          muted={segment.sound === false}
          style={fill}
        />
      </AbsoluteFill>
    );
  // A still: a slow push-in towards its focus point, never a crop past the photo.
  const zoom = segment.zoom ?? 1.06;
  const scale = interpolate(frame, [0, segment.seconds * fps], [1, zoom], {
    extrapolateRight: "clamp",
  });
  const focus = segment.focus ?? { x: 0.5, y: 0.5 };
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <Img
        src={url(baseUrl, segment.src)}
        style={{
          ...fill,
          transform: `scale(${scale})`,
          transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
        }}
      />
    </AbsoluteFill>
  );
}

function TextElement({ text, spec }: { text: MotionMoxText; spec: MotionMoxSpec }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const el = MOTIONMOX_ELEMENTS[text.element];
  const v = visibility(t, { from: text.from, to: text.to }, el);
  if (v <= 0) return null;
  const pop = spring({
    frame: frame - text.from * fps,
    fps,
    config: { damping: 14, stiffness: 140 },
  });
  const short = Math.min(width, height);
  const { look, safe } = spec;
  const font = look.font ? `"${look.font}", Inter, Arial, sans-serif` : "Inter, Arial, sans-serif";
  const side = safe.x * width;
  const base: CSSProperties = {
    position: "absolute",
    fontFamily: font,
    opacity: v,
    lineHeight: 1.08,
  };

  switch (text.element) {
    case "headline":
      return (
        <div
          style={{
            ...base,
            left: side,
            right: side,
            top: safe.top * height,
            fontSize: short * 0.085,
            fontWeight: 800,
            color: look.paper,
            textShadow: "0 2px 18px rgba(0,0,0,0.55)",
            transform: `translateY(${(1 - pop) * short * 0.04}px)`,
            letterSpacing: "-0.01em",
          }}
        >
          {text.text}
        </div>
      );
    case "lower-third":
      return (
        <div
          style={{
            ...base,
            left: side,
            bottom: (safe.bottom + 0.14) * height,
            maxWidth: width - side * 2,
            padding: `${short * 0.02}px ${short * 0.035}px`,
            backgroundColor: look.paper,
            color: look.ink,
            fontSize: short * 0.042,
            fontWeight: 700,
            borderLeft: `${short * 0.012}px solid ${look.accent}`,
            transform: `translateX(${(1 - pop) * -short * 0.2}px)`,
          }}
        >
          {text.text}
        </div>
      );
    case "price-tag":
      return (
        <div
          style={{
            ...base,
            right: side,
            top: height * 0.42,
            padding: `${short * 0.025}px ${short * 0.04}px`,
            borderRadius: short * 0.03,
            backgroundColor: look.accent,
            color: look.ink,
            fontSize: short * 0.07,
            fontWeight: 900,
            transform: `rotate(-4deg) scale(${0.6 + 0.4 * pop})`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}
        >
          {text.text}
        </div>
      );
    case "badge":
      return (
        <div
          style={{
            ...base,
            left: side,
            top: (safe.top + 0.12) * height,
            padding: `${short * 0.012}px ${short * 0.03}px`,
            borderRadius: 999,
            backgroundColor: look.accent,
            color: look.ink,
            fontSize: short * 0.034,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            transform: `scale(${0.7 + 0.3 * pop})`,
          }}
        >
          {text.text}
        </div>
      );
    case "cta":
      return (
        <div
          style={{
            ...base,
            left: 0,
            right: 0,
            bottom: (safe.bottom + 0.02) * height,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              padding: `${short * 0.028}px ${short * 0.07}px`,
              borderRadius: 999,
              backgroundColor: look.accent,
              color: look.ink,
              fontSize: short * 0.05,
              fontWeight: 800,
              transform: `translateY(${(1 - pop) * short * 0.08}px)`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
          >
            {text.text}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function Captions({ spec }: { spec: MotionMoxSpec }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const cue = spec.captions.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  const short = Math.min(width, height);
  const lift = interpolate(t, [cue.start, cue.start + 0.12], [short * 0.012, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: spec.safe.x * width,
        right: spec.safe.x * width,
        bottom: (spec.safe.bottom + 0.05) * height,
        textAlign: "center",
        transform: `translateY(${lift}px)`,
        fontFamily: spec.look.font
          ? `"${spec.look.font}", Inter, Arial, sans-serif`
          : "Inter, Arial, sans-serif",
      }}
    >
      {cue.lines.map((line, li) => (
        // One row per line, each on its own plate.
        <div key={li} style={{ display: "flex", justifyContent: "center", margin: "0.15em 0" }}>
          <div
            style={{
              display: "inline-block",
              padding: "0.1em 0.4em",
              borderRadius: short * 0.012,
              backgroundColor: "rgba(0,0,0,0.62)",
              fontSize: short * 0.05,
              fontWeight: 800,
              color: "#ffffff",
              whiteSpace: "pre",
            }}
          >
            {line.map((word, wi) => (
              // Real spaces between words, so the line reads as words, not one run.
              <span key={wi}>
                {wi > 0 ? " " : null}
                <span
                  style={
                    cue.emphasis && cue.emphasis[0] === li && cue.emphasis[1] === wi
                      ? { color: spec.look.accent }
                      : undefined
                  }
                >
                  {word}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ spec, total }: { spec: MotionMoxSpec; total: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        height: Math.max(4, height * 0.006),
        width: (frame / total) * width,
        backgroundColor: spec.look.accent,
      }}
    />
  );
}

export function MotionMoxVideo({ spec, baseUrl }: MotionMoxProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const transitionFrames = Math.round(spec.transitionSeconds * fps);
  const overlay = spec.overlay;
  const overlayOpacity = overlay
    ? interpolate(
        t,
        [overlay.from, overlay.from + 0.5, overlay.to - 0.5, overlay.to],
        [0, 1, 1, 0],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        },
      )
    : 0;
  const logoOpacity = spec.logo
    ? interpolate(t, [spec.logo.from, spec.logo.from + 0.6], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <TransitionSeries>
        {spec.segments.flatMap((segment, i) => {
          const items = [
            <TransitionSeries.Sequence
              key={`s${i}`}
              durationInFrames={Math.max(1, Math.round(segment.seconds * fps))}
            >
              <Segment segment={segment} baseUrl={baseUrl} />
            </TransitionSeries.Sequence>,
          ];
          if (i < spec.segments.length - 1 && transitionFrames > 0)
            items.push(
              <TransitionSeries.Transition
                key={`t${i}`}
                presentation={presentation(spec)}
                timing={linearTiming({ durationInFrames: transitionFrames })}
              />,
            );
          return items;
        })}
      </TransitionSeries>
      {overlay && overlayOpacity > 0 ? (
        <AbsoluteFill style={{ opacity: overlayOpacity }}>
          <Img src={url(baseUrl, overlay.src)} style={{ width: "100%", height: "100%" }} />
        </AbsoluteFill>
      ) : null}
      {spec.texts.map((text, i) => (
        <TextElement key={i} text={text} spec={spec} />
      ))}
      <Captions spec={spec} />
      {spec.logo && logoOpacity > 0 ? (
        <AbsoluteFill style={{ opacity: logoOpacity }}>
          <Img src={url(baseUrl, spec.logo.src)} style={{ width: "100%", height: "100%" }} />
        </AbsoluteFill>
      ) : null}
      {spec.progressBar ? <ProgressBar spec={spec} total={durationInFrames} /> : null}
    </AbsoluteFill>
  );
}
