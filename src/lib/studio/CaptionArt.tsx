// One caption, drawn: the words on a soft dark plate, one word in the
// brand's colour. Rendered by next/og (satori) on the server, so it keeps to
// inline styles and flexbox, with sizes derived from the font size.
import type { CaptionColours, Cue } from "./captions";

export function CaptionArt({
  cue,
  colours,
  width,
  height,
  fontSize,
  fontFamily,
}: {
  cue: Cue;
  colours: CaptionColours;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
}) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: Math.round(width * 0.86),
          padding: `${Math.round(fontSize * 0.28)}px ${Math.round(fontSize * 0.55)}px`,
          borderRadius: Math.round(fontSize * 0.4),
          background: colours.plate,
        }}
      >
        {cue.lines.map((line, l) => (
          <div
            key={l}
            style={{
              display: "flex",
              justifyContent: "center",
              ...(fontFamily ? { fontFamily } : {}),
              fontSize,
              fontWeight: 700,
              lineHeight: 1.22,
              letterSpacing: -0.2,
              color: colours.text,
              textShadow: "0 2px 8px rgba(0,0,0,0.35)",
            }}
          >
            {line.map((word, w) => {
              const lit = cue.emphasis?.[0] === l && cue.emphasis?.[1] === w;
              return (
                <span
                  key={w}
                  style={{
                    marginRight: w < line.length - 1 ? Math.round(fontSize * 0.26) : 0,
                    color: lit ? colours.highlight : colours.text,
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
