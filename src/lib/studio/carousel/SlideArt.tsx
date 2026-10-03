// One carousel slide, drawn. The same element tree is shown in the Studio
// preview (browser) and turned into the image that gets published (server,
// next/og), so what people approve is what goes out.
//
// Rules that keep both renderers in step: inline styles only, flexbox only,
// every element with more than one child is a flex container, and every size
// is a number derived from the canvas width. No hooks, no browser APIs.
import type { CSSProperties, ReactElement } from "react";
import { fontStack } from "@/lib/brand-kit/fonts";
import type { CarouselSlide } from "../jobs";
import {
  bodySize,
  headingSize,
  slideColors,
  type CarouselDesign,
  type CarouselTheme,
} from "./design";
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
  /** Generated cover picture, behind slide one. */
  coverImage?: string | null;
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
        fontFamily: font,
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.08,
        letterSpacing: -0.02 * size,
        color,
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

export function SlideArt(props: SlideArtProps): ReactElement {
  const { design, theme, width: w, height: h, index } = props;
  const slides = withRoles(props.slides);
  const slide = slides[index] ?? slides[0];
  const count = slides.length;
  const role = slide.role ?? "point";
  const u = w / 1080;
  const square = h / w < 1.1;
  const art = index === 0 && props.coverImage ? props.coverImage : null;

  const base = slideColors(theme, role);
  // Over a picture the text is always white on a dark scrim.
  const c: Colors = art
    ? { ...base, ink: "#ffffff", muted: "rgba(255,255,255,0.78)", line: "rgba(255,255,255,0.3)" }
    : base;

  const headFont = fontStack(theme.headingFont);
  const bodyFont = fontStack(theme.bodyFont);
  const pad = 84 * u;
  const hSize = headingSize(role, slide.heading.length, square) * u;
  const bSize = bodySize(slide.body.length, square) * u;
  const number = pointNumber(slides, index);
  const label = number != null ? String(number).padStart(2, "0") : null;
  const soft = design.look === "soft" && !art && role !== "cta";
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
      block={bold || !!art}
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
  if (role === "recap") {
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
      ) : (
        <Motif design={design} index={index} w={w} h={h} c={c} />
      )}
      {design.look === "frame" && !art ? (
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
            justifyContent: role === "cover" ? "flex-end" : "center",
            paddingTop: 40 * u,
            paddingBottom: 40 * u,
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
      </div>
    </div>
  );
}
