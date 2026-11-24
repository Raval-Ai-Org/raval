import "server-only";
// Draws a "job done" post (Round 9, flag `jobdone`): the person's two real
// photos, before and after, cut to their halves (attention crop, never
// redrawn) with a small "Before" / "After" label on each. Throws when a photo
// can't be read; the runner then makes the piece the usual way.
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { jobDoneLayout, jobDonePanels } from "@/lib/studio/job-done";
import { loadFonts } from "@/server/studio/carousel-render.server";

const LABEL_FONT = "Inter";

export async function drawJobDone(args: {
  before: Buffer;
  after: Buffer;
  ratio: string | null | undefined;
  labels?: { before: string; after: string };
}): Promise<Buffer> {
  const layout = jobDoneLayout(args.ratio);
  const panels = jobDonePanels(layout);
  const cut = (bytes: Buffer, p: (typeof panels)[number]) =>
    sharp(bytes, { failOn: "none" })
      .rotate()
      .resize(p.width, p.height, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 90 })
      .toBuffer();
  const [before, after] = await Promise.all([
    cut(args.before, panels[0]),
    cut(args.after, panels[1]),
  ]);
  const labels = args.labels ?? { before: "Before", after: "After" };
  const fonts = await loadFonts([LABEL_FONT]);
  const family = fonts.some((f) => f.name === LABEL_FONT) ? LABEL_FONT : undefined;
  const unit = Math.min(layout.width, layout.height);
  const pill = (text: string, p: (typeof panels)[number], strong: boolean) => (
    <div
      style={{
        position: "absolute",
        left: p.left + Math.round(unit * 0.035),
        top: p.top + p.height - Math.round(unit * 0.035) - Math.round(unit * 0.07),
        height: Math.round(unit * 0.07),
        display: "flex",
        alignItems: "center",
        paddingLeft: Math.round(unit * 0.03),
        paddingRight: Math.round(unit * 0.03),
        borderRadius: 999,
        background: strong ? "#ffffff" : "rgba(17,17,17,0.72)",
        color: strong ? "#111111" : "#ffffff",
        fontSize: Math.round(unit * 0.034),
        fontWeight: 700,
        letterSpacing: unit * 0.001,
        ...(family ? { fontFamily: family } : {}),
      }}
    >
      {text}
    </div>
  );
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        position: "relative",
        width: layout.width,
        height: layout.height,
        background: "#ffffff",
      }}
    >
      {[before, after].map((bytes, i) => (
        <img
          key={i}
          src={`data:image/jpeg;base64,${bytes.toString("base64")}`}
          alt=""
          style={{
            position: "absolute",
            left: panels[i].left,
            top: panels[i].top,
            width: panels[i].width,
            height: panels[i].height,
          }}
        />
      ))}
      {pill(labels.before, panels[0], false)}
      {pill(labels.after, panels[1], true)}
    </div>,
    { width: layout.width, height: layout.height, ...(fonts.length ? { fonts } : {}) },
  );
  return sharp(Buffer.from(await image.arrayBuffer()))
    .jpeg({ quality: 92 })
    .toBuffer();
}
