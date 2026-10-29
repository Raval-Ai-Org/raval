// One carousel slide, drawn. The same element tree is shown in the Studio
// preview (browser) and turned into the image that gets published (server,
// next/og), so what people approve is what goes out.
//
// Rules that keep both renderers in step: inline styles only, flexbox only,
// every element with more than one child is a flex container, and every size
// is a number derived from the canvas width. No hooks, no browser APIs.
import type { CSSProperties, ReactElement } from "react";
import { fontStack } from "@/lib/brand-look/fonts";
import type { CarouselSlide } from "../jobs";
import {
  backdropTiles,
  bodySize,
  headingSize,
  isSeamless,
  ribbonLift,
  slideColors,
  type CarouselDesign,
  type CarouselTheme,
} from "./design";
import { SCREEN_ASPECT, type PhotoFrame } from "./photos";
import { pointNumber, withRoles } from "./story";

export type SlideArtProps = {
  slides: CarouselSlide[];
  index: number;
  design: CarouselDesign;
  theme: CarouselTheme;
  /** Rendered size in pixels. The design is drawn for 1080 wide and scales. */
  width: number;
  height: number;
  brand: string;
  /** Shown on the closing slide: the website, without the protocol. */
  site?: string | null;
  /**
   * Generated cover picture, behind slide one. On a seamless carousel it is
   * the one background picture that runs behind every slide.
   */
  coverImage?: string | null;
  /**
   * The brand's own pictures, in the carousel's photo order (slide.photo
   * indexes into it). Screens arrive already cut to their window's shape.
   */
  photos?: ({ src: string; frame: PhotoFrame } | null)[] | null;
  /** The story structure (story.ts); a running joke has its own layout. */
  structure?: string | null;
};

type Colors = ReturnType<typeof slideColors>;

const row: CSSProperties = { display: "flex", flexDirection: "row", alignItems: "center" };
const col: CSSProperties = { display: "flex", flexDirection: "column" };

/** The shape that crosses slide edges. Drawn in "world" space, so it lines up. */
function Motif({
  design,
  index,
  w,
  h,
  c,
}: {
  design: CarouselDesign;
  index: number;
  w: number;
  h: number;
  c: Colors;
}): ReactElement {
  const u = w / 1080;
  if (design.motif === "glow") {
    // One soft glow that moves to the next corner on every slide.
    const corners = [
      [16, 84],
      [84, 86],
      [86, 14],
      [14, 16],
    ];
    const [x, y] = corners[index % corners.length];
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: w,
          height: h,
          display: "flex",
          opacity: 0.6,
          backgroundImage: `radial-gradient(circle at ${x}% ${y}%, ${c.accent} 0%, ${c.bg} 62%)`,
        }}
      />
    );
  }
  if (design.motif === "wave") {
    // One long sine wave across the whole carousel; this slide shows its part.
    const line = (base: number, amp: number, phase: number) => {
      const pts: string[] = [];
      for (let i = 0; i <= 36; i++) {
        const x = (w * i) / 36;
        const world = index * w + x;
        const y = base + amp * Math.sin((Math.PI * world) / w + phase);
        pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      return pts.join(" ");
    };
    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <path
          d={line(h * 0.865, h * 0.018, 0)}
          stroke={c.accent}
          strokeWidth={3 * u}
          strokeOpacity={0.55}
          fill="none"
        />
        <path
          d={line(h * 0.865, h * 0.018, 0.9)}
          stroke={c.accent}
          strokeWidth={2 * u}
          strokeOpacity={0.22}
          fill="none"
        />
      </svg>
    );
  }
  // Shapes centred on the slide boundaries: half on this slide, half on the next.
  const boundaries = [index, index + 1];
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, display: "flex" }}>
      {boundaries.map((k) => {
        const x = (k - index) * w;
        const high = k % 2 === 0;
        if (design.motif === "blocks") {
          const bw = w * 0.42;
          const bh = h * 0.13;
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                left: x - bw / 2,
                top: high ? h * 0.115 : h * 0.7,
                width: bw,
                height: bh,
                borderRadius: 36 * u,
                background: c.accent,
                opacity: 0.16,
              }}
            />
          );
        }
        const r = w * 0.3;
        return (
          <div
            key={k}
            style={{
              position: "absolute",
              left: x - r,
              top: (high ? h * 0.03 : h * 0.97) - r,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              border: `${3 * u}px solid ${c.accent}`,
              opacity: 0.38,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The background of a seamless carousel: one long picture, of which this slide
 * shows its own stretch. Everything is placed by its distance from the start
 * of the carousel, so two neighbouring slides agree at the edge they share,
 * and the last slide agrees with the first.
 */
function Panorama({
  design,
  index,
  count,
  w,
  h,
  c,
  picture,
}: {
  design: CarouselDesign;
  index: number;
  count: number;
  w: number;
  h: number;
  c: Colors;
  /** The generated background, shared by every slide. */
  picture?: string | null;
}): ReactElement {
  const u = w / 1080;
  const STEPS = 48;
  // The copies of the picture that cross this slide (see backdropTiles).
  const tile = backdropTiles(count, w, h);
  const first = Math.floor((index * w) / tile.width + 1e-6);
  const last = Math.ceil(((index + 1) * w) / tile.width - 1e-6) - 1;
  const tiles = picture ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [];
  const lift = (x: number, layer: 0 | 1) => ribbonLift(x, count, layer, design.motif) * u;
  const edge = (layer: 0 | 1) => {
    const pts: string[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const x = (w * i) / STEPS;
      const y = h - lift(index + i / STEPS, layer);
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return pts.join(" ");
  };
  const back = edge(0);
  const front = edge(1);
  const fill = (line: string) => `${line} L${w} ${h} L0 ${h} Z`;
  const bead = 18 * u;
  const seams = [index, index + 1];
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, display: "flex" }}>
      {tiles.map((t) => (
        <img
          key={`tile-${t}`}
          src={picture ?? ""}
          alt=""
          width={tile.width}
          height={h}
          style={{
            position: "absolute",
            left: t * tile.width - index * w,
            top: 0,
            width: tile.width,
            height: h,
            objectFit: "cover",
            // Every second copy is mirrored, so neighbours meet on the same pixels.
            ...(t % 2 ? { transform: "scaleX(-1)" } : {}),
          }}
        />
      ))}
      {picture ? (
        // The brand's own canvas colour over the picture keeps the words readable.
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            display: "flex",
            background: c.bg,
            opacity: 0.62,
          }}
        />
      ) : null}
      {seams.map((k) => {
        if (picture) return null;
        const x = (k - index) * w;
        // The same shape at the carousel's two ends, so the loop closes.
        const j = ((k % count) + count) % count;
        const high = j % 2 === 0;
        if (design.motif === "blocks") {
          const bw = w * 0.4;
          const bh = h * 0.1;
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                left: x - bw / 2,
                top: high ? h * 0.1 : h * 0.52,
                width: bw,
                height: bh,
                borderRadius: bh / 2,
                background: c.accent,
                opacity: 0.14,
              }}
            />
          );
        }
        if (design.motif === "orbit") {
          const r = (250 + 60 * (j % 3)) * u;
          return (
            <div
              key={k}
              style={{
                position: "absolute",
                left: x - r,
                top: (high ? h * 0.3 : h * 0.56) - r,
                width: r * 2,
                height: r * 2,
                borderRadius: r,
                border: `${3 * u}px solid ${c.accent}`,
                opacity: 0.3,
              }}
            />
          );
        }
        return null;
      })}
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: "absolute", left: 0, top: 0 }}
      >
        <path d={fill(back)} fill={c.accent} fillOpacity={0.14} />
        <path d={fill(front)} fill={c.accent} fillOpacity={0.2} />
        <path d={back} stroke={c.accent} strokeWidth={4 * u} fill="none" />
        {/* A bead on the line at each edge: half on this slide, half on the next. */}
        {seams.map((k) => (
          <circle key={k} cx={(k - index) * w} cy={h - lift(k, 0)} r={bead} fill={c.accent} />
        ))}
      </svg>
    </div>
  );
}

/** Heading words, wrapped by hand so highlighted words can be styled. */
export function Heading({
  text,
  emphasis,
  size,
  color,
  accent,
  accentInk,
  font,
  block,
  upper,
  align,
}: {
  text: string;
  emphasis?: string;
  size: number;
  color: string;
  accent: string;
  accentInk: string;
  font: string;
  /** Highlight as a filled block instead of a colour. */
  block: boolean;
  /** Set in capitals with a heavier weight (the swiss look). */
  upper?: boolean;
  align?: "left" | "center";
}): ReactElement {
  const at = emphasis ? text.toLowerCase().indexOf(emphasis.toLowerCase()) : -1;
  const end = at >= 0 ? at + (emphasis?.length ?? 0) : -1;
  let cursor = 0;
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const start = text.indexOf(word, cursor);
      cursor = start + word.length;
      return { word, hot: at >= 0 && start >= at && start < end };
    });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        fontFamily: font,
        fontSize: size,
        fontWeight: upper ? 800 : 700,
        lineHeight: upper ? 0.98 : 1.08,
        letterSpacing: -0.02 * size,
        color,
        ...(upper ? { textTransform: "uppercase" as const } : {}),
      }}
    >
      {words.map((w, i) => (
        <span
          key={i}
          style={
            w.hot && block
              ? {
                  background: accent,
                  color: accentInk,
                  paddingLeft: size * 0.12,
                  paddingRight: size * 0.12,
                  borderRadius: size * 0.1,
                  marginRight: size * 0.14,
                }
              : { marginRight: size * 0.24, ...(w.hot ? { color: accent } : {}) }
          }
        >
          {w.word}
        </span>
      ))}
    </div>
  );
}

function Arrow({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Check({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * One of the brand's own pictures, framed: a screen sits in a phone or a
 * browser window, a photo is a rounded card. Sizes come from the box it gets.
 */
function PhotoBlock({
  src,
  frame,
  boxW,
  boxH,
  u,
  c,
}: {
  src: string;
  frame: PhotoFrame;
  boxW: number;
  boxH: number;
  u: number;
  c: Colors;
}): ReactElement {
  const shadow = "0 18px 50px rgba(0,0,0,0.22)";
  if (frame === "phone") {
    const bezel = 14 * u;
    const innerH = boxH - bezel * 2;
    const innerW = innerH * SCREEN_ASPECT.phone;
    return (
      <div
        style={{
          display: "flex",
          alignSelf: "center",
          padding: bezel,
          borderRadius: 64 * u,
          background: "#0d0e10",
          boxShadow: shadow,
        }}
      >
        <img
          src={src}
          alt=""
          width={innerW}
          height={innerH}
          style={{ width: innerW, height: innerH, borderRadius: 50 * u, objectFit: "cover" }}
        />
      </div>
    );
  }
  if (frame === "browser") {
    const bar = 44 * u;
    const innerW = Math.min(boxW, (boxH - bar) * SCREEN_ASPECT.browser);
    const innerH = innerW / SCREEN_ASPECT.browser;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignSelf: "center",
          borderRadius: 22 * u,
          overflow: "hidden",
          background: c.surface,
          border: `${2 * u}px solid ${c.line}`,
          boxShadow: shadow,
        }}
      >
        <div style={{ ...row, height: bar, paddingLeft: 20 * u, gap: 10 * u }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 13 * u,
                height: 13 * u,
                borderRadius: 7 * u,
                background: c.line,
              }}
            />
          ))}
        </div>
        <img
          src={src}
          alt=""
          width={innerW}
          height={innerH}
          style={{ width: innerW, height: innerH, objectFit: "cover" }}
        />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={boxW}
      height={boxH}
      style={{
        width: boxW,
        height: boxH,
        borderRadius: 28 * u,
        objectFit: "cover",
        boxShadow: shadow,
      }}
    />
  );
}

export function SlideArt(props: SlideArtProps): ReactElement {
  const { design, theme, width: w, height: h, index } = props;
  const slides = withRoles(props.slides);
  const slide = slides[index] ?? slides[0];
  const count = slides.length;
  const role = slide.role ?? "point";
  const u = w / 1080;
  const square = h / w < 1.1;
  // One long picture: no cover photo and no colour flip, or an edge would show.
  const seamless = isSeamless(design);
  const swiss = design.look === "swiss" && !seamless;
  const joke = props.structure === "running-joke";
  const pic = slide.photo != null ? (props.photos?.[slide.photo] ?? null) : null;
  // A photo on the cover is the whole slide; anywhere else it is framed.
  const art = seamless
    ? null
    : index === 0 && pic?.frame === "photo"
      ? pic.src
      : index === 0 && props.coverImage
        ? props.coverImage
        : null;
  const framed = pic && pic.src !== art ? pic : null;

  const base = slideColors(theme, seamless || swiss ? "point" : role);
  // Over a picture the text is always white on a dark scrim.
  const c: Colors = art
    ? { ...base, ink: "#ffffff", muted: "rgba(255,255,255,0.78)", line: "rgba(255,255,255,0.3)" }
    : base;

  const headFont = fontStack(theme.headingFont);
  const bodyFont = fontStack(theme.bodyFont);
  const pad = 84 * u;
  const hSize =
    headingSize(role, slide.heading.length, square) * u * (joke ? 1.45 : swiss ? 1.1 : 1);
  const bSize = bodySize(slide.body.length, square) * u;
  const number = pointNumber(slides, index);
  const label = number != null ? String(number).padStart(2, "0") : null;
  const soft = design.look === "soft" && !art && (seamless || role !== "cta");
  const bold = design.look === "bold";

  const kicker = slide.kicker ? (
    <div
      style={{
        display: "flex",
        fontFamily: bodyFont,
        fontSize: 26 * u,
        fontWeight: 700,
        letterSpacing: 3 * u,
        textTransform: "uppercase",
        color: art ? "#ffffff" : c.accent,
      }}
    >
      {slide.kicker}
    </div>
  ) : null;

  const heading = (
    <Heading
      text={slide.heading}
      emphasis={slide.emphasis}
      size={hSize}
      color={c.ink}
      accent={art ? "#ffffff" : c.accent}
      accentInk={art ? "#111315" : c.accentInk}
      font={headFont}
      block={(bold || !!art) && !swiss}
      upper={swiss}
      align={joke ? "center" : "left"}
    />
  );

  const body = slide.body ? (
    <div
      style={{
        display: "flex",
        fontFamily: bodyFont,
        fontSize: bSize,
        fontWeight: 400,
        lineHeight: 1.36,
        color: role === "cover" || role === "cta" ? c.ink : c.muted,
        opacity: role === "cover" || role === "cta" ? 0.88 : 1,
      }}
    >
      {slide.body}
    </div>
  ) : null;

  /** The number on a point slide, in the look's own way. */
  const numeral = !label ? null : design.look === "bold" ? (
    <div
      style={{
        display: "flex",
        fontFamily: headFont,
        fontSize: (square ? 190 : 250) * u,
        fontWeight: 700,
        lineHeight: 0.9,
        letterSpacing: -8 * u,
        color: c.accent,
      }}
    >
      {label}
    </div>
  ) : design.look === "soft" ? (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 104 * u,
        height: 104 * u,
        borderRadius: 52 * u,
        background: c.accent,
        color: c.accentInk,
        fontFamily: headFont,
        fontSize: 44 * u,
        fontWeight: 700,
      }}
    >
      {label}
    </div>
  ) : design.look === "frame" ? (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        background: c.accent,
        color: c.accentInk,
        fontFamily: headFont,
        fontSize: 40 * u,
        fontWeight: 700,
        padding: `${10 * u}px ${24 * u}px`,
        borderRadius: 12 * u,
      }}
    >
      {label}
    </div>
  ) : (
    <div style={{ ...row, gap: 24 * u }}>
      <div
        style={{
          display: "flex",
          fontFamily: headFont,
          fontSize: 60 * u,
          fontWeight: 700,
          color: c.accent,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flex: 1, height: 2 * u, background: c.line }} />
    </div>
  );

  let main: ReactElement;
  if (joke) {
    // The same template on every slide: a small setup, a big punchline.
    main = (
      <div style={{ ...col, alignItems: "center", gap: 28 * u }}>
        {slide.body ? (
          <div
            style={{
              display: "flex",
              textAlign: "center",
              fontFamily: bodyFont,
              fontSize: 40 * u,
              lineHeight: 1.25,
              color: c.ink,
            }}
          >
            {slide.body}
          </div>
        ) : null}
        {heading}
      </div>
    );
  } else if (swiss) {
    // Heavy capitals top-left, a wide empty middle, the quieter line low down.
    main = (
      <div style={{ ...col, flex: 1, justifyContent: "space-between", gap: 40 * u }}>
        <div style={{ ...col, gap: 28 * u }}>
          {kicker}
          {heading}
        </div>
        {framed ? (
          <PhotoBlock
            src={framed.src}
            frame={framed.frame}
            boxW={w - pad * 2}
            boxH={h * (square ? 0.4 : 0.44)}
            u={u}
            c={c}
          />
        ) : null}
        {slide.body ? (
          <div
            style={{
              display: "flex",
              fontFamily: headFont,
              fontSize: (slide.body.length <= 40 ? 64 : 42) * u,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -1 * u,
              color: role === "cta" ? c.accent : c.muted,
            }}
          >
            {slide.body}
          </div>
        ) : null}
        {role === "cta" && props.site ? (
          <div style={{ display: "flex", fontFamily: bodyFont, fontSize: 30 * u, color: c.ink }}>
            {props.site}
          </div>
        ) : null}
      </div>
    );
  } else if (framed) {
    main = (
      <div style={{ ...col, gap: 36 * u }}>
        <PhotoBlock
          src={framed.src}
          frame={framed.frame}
          boxW={w - pad * 2}
          boxH={h * (square ? 0.42 : 0.48)}
          u={u}
          c={c}
        />
        <div style={{ ...col, gap: 18 * u }}>
          {kicker}
          {heading}
          {role === "cover" ? null : body}
        </div>
      </div>
    );
  } else if (role === "recap") {
    const lines = slide.body
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5);
    main = (
      <div style={{ ...col, gap: 40 * u }}>
        {kicker}
        {heading}
        <div style={{ ...col, gap: 22 * u }}>
          {lines.map((line, i) => (
            <div key={i} style={{ ...row, gap: 22 * u }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 52 * u,
                  height: 52 * u,
                  borderRadius: 26 * u,
                  background: c.accent,
                  flexShrink: 0,
                }}
              >
                <Check size={30 * u} color={c.accentInk} />
              </div>
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  fontFamily: bodyFont,
                  fontSize: 40 * u,
                  lineHeight: 1.25,
                  color: c.ink,
                }}
              >
                {line}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (role === "cta") {
    main = (
      <div style={{ ...col, gap: 36 * u }}>
        {heading}
        {body}
        {props.site ? (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              marginTop: 12 * u,
              padding: `${18 * u}px ${34 * u}px`,
              borderRadius: 999,
              background: c.accent,
              color: c.accentInk,
              fontFamily: bodyFont,
              fontSize: 34 * u,
              fontWeight: 700,
            }}
          >
            {props.site}
          </div>
        ) : null}
      </div>
    );
  } else if (role === "context") {
    main = (
      <div style={{ ...col, gap: 36 * u }}>
        {kicker}
        {heading}
        <div style={{ ...row, alignItems: "stretch", gap: 28 * u }}>
          <div
            style={{ display: "flex", width: 6 * u, borderRadius: 3 * u, background: c.accent }}
          />
          <div style={{ display: "flex", flex: 1 }}>{body}</div>
        </div>
      </div>
    );
  } else {
    main = (
      <div style={{ ...col, gap: (role === "cover" ? 32 : 30) * u }}>
        {role === "cover" ? null : numeral}
        {kicker}
        {heading}
        {body}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: w,
        height: h,
        overflow: "hidden",
        background: c.bg,
        color: c.ink,
        fontFamily: bodyFont,
      }}
    >
      {art ? (
        <img
          src={art}
          alt=""
          width={w}
          height={h}
          style={{ position: "absolute", left: 0, top: 0, width: w, height: h, objectFit: "cover" }}
        />
      ) : null}
      {art ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            display: "flex",
            backgroundImage:
              "linear-gradient(to top, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0.5) 42%, rgba(0,0,0,0.18) 72%, rgba(0,0,0,0.34) 100%)",
          }}
        />
      ) : seamless ? (
        <Panorama
          design={design}
          index={index}
          count={count}
          w={w}
          h={h}
          c={c}
          picture={props.coverImage}
        />
      ) : swiss ? null : (
        <Motif design={design} index={index} w={w} h={h} c={c} />
      )}
      {design.look === "frame" && !art && !seamless ? (
        <div
          style={{
            position: "absolute",
            left: 36 * u,
            top: 36 * u,
            width: w - 72 * u,
            height: h - 72 * u,
            display: "flex",
            border: `${2 * u}px solid ${c.line}`,
            borderRadius: 28 * u,
          }}
        />
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          padding: pad,
        }}
      >
        <div style={{ ...row, justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              fontFamily: bodyFont,
              fontSize: 28 * u,
              fontWeight: 700,
              color: c.ink,
            }}
          >
            {props.brand}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: bodyFont,
              fontSize: 26 * u,
              fontWeight: 400,
              color: c.muted,
            }}
          >
            {`${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: swiss
              ? "flex-start"
              : joke
                ? "center"
                : role === "cover" && !framed
                  ? "flex-end"
                  : "center",
            paddingTop: 40 * u,
            // The ribbon runs along the bottom of a seamless carousel.
            paddingBottom: (seamless ? 170 : 40) * u,
          }}
        >
          {soft ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                background: c.surface,
                borderRadius: 44 * u,
                padding: 56 * u,
              }}
            >
              {main}
            </div>
          ) : (
            main
          )}
        </div>

        {/* A connected carousel has no page dots or arrow: the picture itself leads on. */}
        {seamless ? null : swiss ? (
          // Swiss keeps only a quiet arrow, bottom right, until the last slide.
          <div style={{ ...row, justifyContent: "flex-end", height: 48 * u }}>
            {index < count - 1 ? <Arrow size={48 * u} color={c.muted} /> : null}
          </div>
        ) : (
          <div style={{ ...row, justifyContent: "space-between" }}>
            <div style={{ ...row, gap: 10 * u }}>
              {slides.map((_, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    width: (i === index ? 56 : 22) * u,
                    height: 8 * u,
                    borderRadius: 4 * u,
                    background: i === index ? c.accent : c.line,
                  }}
                />
              ))}
            </div>
            {index < count - 1 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 76 * u,
                  height: 76 * u,
                  borderRadius: 38 * u,
                  background: art ? "#ffffff" : c.accent,
                }}
              >
                <Arrow size={38 * u} color={art ? "#111315" : c.accentInk} />
              </div>
            ) : (
              <div style={{ display: "flex", width: 76 * u, height: 76 * u }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
