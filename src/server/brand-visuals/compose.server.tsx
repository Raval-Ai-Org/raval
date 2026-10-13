import "server-only";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { VisualSnapshot } from "@/lib/brand-visuals/contracts";
import { resolveLook } from "@/lib/brand-look/resolve";
import { carouselTheme, carouselFont, canRenderText } from "@/lib/studio/carousel/design";
import { applyVisualTaste } from "@/lib/brand-visuals/apply";
import { loadFonts } from "@/server/studio/carousel-render.server";

/** Original art remains a separate owned asset; exact text is composed once. */
export async function composeVisualArtwork(args: {
  art: Buffer;
  snapshot: VisualSnapshot;
  headline: string;
  brandName: string;
  ratio: string;
  dna?: Record<string, unknown> | null;
  onWarning?: (message: string) => void;
}): Promise<Buffer> {
  if (!canRenderText(args.headline + args.brandName))
    throw new Error("This text needs a font that the image editor cannot render yet.");
  const look = applyVisualTaste(resolveLook(args.dna as never), args.dna?.look, args.snapshot);
  const theme = carouselTheme({
    palette: look.visual.palette,
    fonts: look.visual.typography,
    colorway: args.snapshot.direction.colorway,
  });
  const heading = carouselFont(look.visual.typography?.heading, "Inter");
  const body = carouselFont(look.visual.typography?.body, "Inter");
  const width = 1080;
  const height =
    args.ratio === "9:16" ? 1920 : args.ratio === "16:9" ? 608 : args.ratio === "4:5" ? 1350 : 1080;
  const fitted = await sharp(args.art)
    .resize(width, Math.round(height * 0.64), { fit: "cover" })
    .jpeg({ quality: 88 })
    .toBuffer();
  const source = `data:image/jpeg;base64,${fitted.toString("base64")}`;
  const fonts = await loadFonts([heading, body]);
  if ([heading, body].some((family) => !fonts.some((font) => font.name === family)))
    args.onWarning?.(
      "Some brand fonts could not be loaded. Check the composed typography before publishing.",
    );
  if (
    (look.visual.typography?.heading &&
      heading.toLowerCase() !== look.visual.typography.heading.toLowerCase()) ||
    (look.visual.typography?.body &&
      body.toLowerCase() !== look.visual.typography.body.toLowerCase())
  )
    args.onWarning?.(
      "This brand font needs a supported alternative for editable layouts. A close font was used.",
    );
  const reverse = args.snapshot.direction.layout === "frame";
  const soft = args.snapshot.direction.layout === "soft";
  const bold = args.snapshot.direction.layout === "bold";
  const headlineSize = Math.max(
    32,
    Math.min(
      args.ratio === "16:9" ? 38 : bold ? 72 : 58,
      Math.floor(580 / Math.sqrt(Math.max(1, args.headline.length))),
    ),
  );
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: reverse ? "column-reverse" : "column",
        width,
        height,
        background: bold ? theme.accent : theme.bg,
        color: bold ? theme.accentInk : theme.ink,
        fontFamily: body,
        padding: soft ? 32 : 0,
      }}
    >
      <img
        src={source}
        alt=""
        style={{
          width: soft ? width - 64 : width,
          height: Math.round(height * 0.64),
          objectFit: "cover",
          borderRadius: soft ? 28 : 0,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "36px 64px",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: heading,
            fontSize: headlineSize,
            fontWeight: look.visual.typography?.headingWeight ?? 700,
            lineHeight: 1.12,
            letterSpacing:
              look.visual.typography?.tracking === "tight"
                ? -headlineSize * 0.03
                : look.visual.typography?.tracking === "wide"
                  ? headlineSize * 0.06
                  : look.visual.typography?.tracking === "normal"
                    ? 0
                    : -1,
            maxWidth: 952,
          }}
        >
          {args.headline}
        </div>
        <div style={{ display: "flex", fontSize: 20, color: bold ? theme.accentInk : theme.muted }}>
          {args.brandName}
        </div>
      </div>
    </div>,
    { width, height, ...(fonts.length ? { fonts } : {}) },
  );
  return sharp(Buffer.from(await image.arrayBuffer()))
    .jpeg({ quality: 92 })
    .toBuffer();
}
