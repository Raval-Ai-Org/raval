// One Story frame, drawn. The same element tree is shown in the Studio preview
// (browser) and turned into the 1080×1920 image that gets published (server,
// next/og), so what people approve is what goes out.
//
// Same rules as the carousel slide (src/lib/studio/carousel/SlideArt.tsx):
// inline styles, flexbox only, every multi-child element a flex container,
// every size derived from the width. It shares the carousel's colour system
// and heading, so a brand's Stories and carousels look like one profile.
//
// Text stays out of the Story safe zones (progress bar and name at the top,
// reply bar at the bottom). Things the API can't publish natively (link,
// poll and question stickers) are drawn as honest design elements instead:
// a web address with "link in bio", and answer chips people reply with.
import type { CSSProperties, ReactElement } from "react";
import { fontStack } from "@/lib/brand-look/fonts";
import { Heading } from "@/lib/studio/carousel/SlideArt";
import { mixHex, type CarouselDesign, type CarouselTheme } from "@/lib/studio/carousel/design";
import type { StoryFrame, StoryFrameRole } from "./frames";
import { STORY_SAFE_ZONE } from "./placement";

export type StoryArtProps = {
  frames: StoryFrame[];
  index: number;
  design: CarouselDesign;
  theme: CarouselTheme;
  /** Rendered size in pixels; the design is drawn for 1080×1920 and scales. */
  width: number;
  height: number;
  brand: string;
  /** The website, without the protocol, shown on the closing frame. */
  site?: string | null;
  /** A picture behind this frame (data URL or signed URL), if there is one. */
  background?: string | null;
};

const col: CSSProperties = { display: "flex", flexDirection: "column" };
const row: CSSProperties = { display: "flex", flexDirection: "row", alignItems: "center" };

function frameColors(theme: CarouselTheme, role: StoryFrameRole) {
  // The close and the offer flip to the accent, like a carousel's last slide.
  if (role === "cta" || role === "offer") {
    const ink = theme.accentInk;
    return {
      bg: theme.accent,
      ink,
      muted: mixHex(ink, theme.accent, 0.3),
      accent: ink,
      accentInk: theme.accent,
      surface: mixHex(theme.accent, ink, 0.12),
      line: mixHex(theme.accent, ink, 0.24),
    };
  }
  return {
    bg: theme.bg,
    ink: theme.ink,
    muted: theme.muted,
    accent: theme.accent,
    accentInk: theme.accentInk,
    surface: theme.surface,
    line: theme.line,
  };
}

function headingPx(role: StoryFrameRole, chars: number): number {
  const big = role === "hook" || role === "cta" || role === "offer";
  const steps = big ? [132, 112, 96, 82] : [104, 90, 78, 66];
  return chars <= 22 ? steps[0] : chars <= 40 ? steps[1] : chars <= 60 ? steps[2] : steps[3];
}

function bodyPx(chars: number): number {
  return chars <= 70 ? 50 : chars <= 130 ? 44 : 40;
}

export function StoryArt(props: StoryArtProps): ReactElement {
  const { theme, design, width: w, height: h, index } = props;
  const frame = props.frames[index] ?? props.frames[0];
  const role = frame?.role ?? "value";
  const u = w / 1080;
  const photo = props.background ?? null;
  const base = frameColors(theme, role);
  const c = photo
    ? { ...base, ink: "#ffffff", muted: "rgba(255,255,255,0.82)", line: "rgba(255,255,255,0.35)" }
    : base;
  const headFont = fontStack(theme.headingFont);
  const bodyFont = fontStack(theme.bodyFont);
  const top = Math.round(h * STORY_SAFE_ZONE.top);
  const bottom = Math.round(h * STORY_SAFE_ZONE.bottom);
  const side = 88 * u;
  const heading = frame?.heading ?? "";
  const body = frame?.body ?? "";

  const kicker = frame?.kicker ? (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        fontFamily: bodyFont,
        fontSize: 30 * u,
        fontWeight: 700,
        letterSpacing: 3 * u,
        textTransform: "uppercase",
        color: photo ? "#111315" : c.accentInk,
        background: photo ? "#ffffff" : c.accent,
        padding: `${10 * u}px ${22 * u}px`,
        borderRadius: 999,
      }}
    >
      {frame.kicker}
    </div>
  ) : null;

  const title = (
    <Heading
      text={heading}
      emphasis={frame?.emphasis}
      size={headingPx(role, heading.length) * u}
      color={c.ink}
      accent={photo ? "#ffffff" : c.accent}
      accentInk={photo ? "#111315" : c.accentInk}
      font={headFont}
      block={design.look === "bold" || !!photo}
    />
  );

  const text = body ? (
    <div
      style={{
        display: "flex",
        fontFamily: bodyFont,
        fontSize: bodyPx(body.length) * u,
        lineHeight: 1.32,
        color: c.muted,
      }}
    >
      {body}
    </div>
  ) : null;

  let main: ReactElement;
  if (role === "question") {
    const options = frame?.options ?? [];
    main = (
      <div style={{ ...col, gap: 40 * u }}>
        {kicker}
        {title}
        <div style={{ ...col, gap: 22 * u }}>
          {options.map((option, i) => (
            <div
              key={i}
              style={{
                ...row,
                gap: 26 * u,
                padding: `${28 * u}px ${34 * u}px`,
                borderRadius: 32 * u,
                background: photo ? "rgba(255,255,255,0.92)" : c.surface,
                border: `${3 * u}px solid ${photo ? "rgba(255,255,255,0.92)" : c.line}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 64 * u,
                  height: 64 * u,
                  borderRadius: 32 * u,
                  background: photo ? "#111315" : c.accent,
                  color: photo ? "#ffffff" : c.accentInk,
                  fontFamily: headFont,
                  fontSize: 34 * u,
                  fontWeight: 700,
                }}
              >
                {String.fromCharCode(65 + i)}
              </div>
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  fontFamily: bodyFont,
                  fontSize: 44 * u,
                  fontWeight: 700,
                  color: photo ? "#111315" : c.ink,
                }}
              >
                {option}
              </div>
            </div>
          ))}
        </div>
        {text}
      </div>
    );
  } else if (role === "cta" || role === "offer") {
    main = (
      <div style={{ ...col, gap: 40 * u }}>
        {kicker}
        {title}
        {text}
        {role === "cta" && props.site ? (
          <div style={{ ...col, gap: 18 * u }}>
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                padding: `${22 * u}px ${40 * u}px`,
                borderRadius: 999,
                background: photo ? "#ffffff" : c.ink,
                color: photo ? "#111315" : c.bg,
                fontFamily: bodyFont,
                fontSize: 40 * u,
                fontWeight: 700,
              }}
            >
              {props.site}
            </div>
            <div
              style={{
                display: "flex",
                fontFamily: bodyFont,
                fontSize: 32 * u,
                color: c.muted,
              }}
            >
              Link in bio
            </div>
          </div>
        ) : null}
      </div>
    );
  } else {
    main = (
      <div style={{ ...col, gap: 36 * u }}>
        {kicker}
        {title}
        {text}
      </div>
    );
  }

  // A soft accent shape behind the text, offset per frame so the Story moves.
  const blob = !photo ? (
    <div
      style={{
        position: "absolute",
        left: (index % 2 === 0 ? 0.52 : -0.28) * w,
        top: (design.motif === "blocks" ? 0.08 : 0.04) * h + (index % 3) * 0.05 * h,
        width: w * 0.78,
        height: w * 0.78,
        borderRadius: design.motif === "blocks" ? 80 * u : w * 0.39,
        background: c.accent,
        opacity: role === "cta" || role === "offer" ? 0.14 : 0.1,
        display: "flex",
      }}
    />
  ) : null;

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
      {photo ? (
        <img
          src={photo}
          alt=""
          width={w}
          height={h}
          style={{ position: "absolute", left: 0, top: 0, width: w, height: h, objectFit: "cover" }}
        />
      ) : null}
      {photo ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: w,
            height: h,
            display: "flex",
            backgroundImage:
              "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.4) 100%)",
          }}
        />
      ) : null}
      {blob}
      {design.look === "frame" && !photo ? (
        <div
          style={{
            position: "absolute",
            left: 40 * u,
            top: top - 40 * u,
            width: w - 80 * u,
            height: h - top - bottom + 80 * u,
            display: "flex",
            border: `${3 * u}px solid ${c.line}`,
            borderRadius: 44 * u,
          }}
        />
      ) : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          paddingTop: top,
          paddingBottom: bottom,
          paddingLeft: side,
          paddingRight: side,
        }}
      >
        <div style={{ ...row, gap: 18 * u }}>
          <div
            style={{
              display: "flex",
              width: 18 * u,
              height: 18 * u,
              borderRadius: 9 * u,
              background: photo ? "#ffffff" : c.accent,
            }}
          />
          <div
            style={{
              display: "flex",
              fontFamily: bodyFont,
              fontSize: 32 * u,
              fontWeight: 700,
              color: c.ink,
            }}
          >
            {props.brand}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: role === "hook" && photo ? "flex-end" : "center",
            paddingTop: 48 * u,
            paddingBottom: 48 * u,
          }}
        >
          {design.look === "soft" && !photo && role !== "cta" && role !== "offer" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                background: c.surface,
                borderRadius: 52 * u,
                padding: 64 * u,
              }}
            >
              {main}
            </div>
          ) : (
            main
          )}
        </div>
      </div>
    </div>
  );
}
