import "server-only";
import pptxgen from "pptxgenjs";
import sharp from "sharp";
import type { CarouselSlide, CarouselSpecOutput } from "@/lib/studio/jobs";
import { safeTheme, slideColors } from "@/lib/studio/carousel/design";

/** Native PowerPoint text and shapes give Canva import editable elements. */
export async function buildCarouselPptx(
  slides: CarouselSlide[],
  spec: CarouselSpecOutput,
  coverArt?: Buffer | null,
) {
  const theme = safeTheme(spec.theme);
  if (!theme || slides.length < 2 || slides.length > 30) throw new Error("Invalid carousel design");
  const deck = new pptxgen();
  const square = spec.ratio === "1:1";
  const width = 10;
  const height = square ? 10 : 12.5;
  deck.defineLayout({ name: "MELLOX", width, height });
  deck.layout = "MELLOX";
  deck.author = "Mellox AI";
  deck.subject = "Editable carousel";
  const coverJpeg = coverArt?.length
    ? await sharp(coverArt).resize(900, 900, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer()
    : null;
  for (const [index, source] of slides.entries()) {
    const colors = slideColors(theme, source.role);
    const slide = deck.addSlide();
    slide.background = { color: colors.bg.slice(1) };
    slide.addShape(deck.ShapeType.rect, {
      x: 0.55,
      y: 0.64,
      w: 0.13,
      h: 0.75,
      line: { color: colors.accent.slice(1), transparency: 100 },
      fill: { color: colors.accent.slice(1) },
    });
    const kicker = source.kicker || (source.role === "cover" ? spec.brand : `SLIDE ${index + 1}`);
    slide.addText(kicker.slice(0, 100), {
      x: 0.85,
      y: 0.66,
      w: 8.2,
      h: 0.48,
      fontFace: theme.bodyFont,
      fontSize: 19,
      bold: true,
      color: colors.accent.slice(1),
      margin: 0,
    });
    slide.addText(source.heading.slice(0, 600), {
      x: 0.7,
      y: square ? 2.0 : 2.35,
      w: index === 0 && coverJpeg ? 4.5 : 8.6,
      h: square ? 3.0 : 3.8,
      fontFace: theme.headingFont,
      fontSize: source.heading.length > 65 ? 36 : 47,
      bold: true,
      color: colors.ink.slice(1),
      breakLine: false,
      valign: "middle",
      margin: 0,
      fit: "shrink",
    });
    if (index === 0 && coverJpeg) {
      slide.addImage({
        data: `data:image/jpeg;base64,${coverJpeg.toString("base64")}`,
        x: 5.35,
        y: square ? 2.05 : 2.4,
        w: 3.9,
        h: square ? 4.35 : 5.0,
      });
    }
    if (source.body)
      slide.addText(source.body.slice(0, 1500), {
        x: 0.75,
        y: square ? 5.35 : 6.6,
        w: 8.45,
        h: square ? 2.4 : 3.0,
        fontFace: theme.bodyFont,
        fontSize: 23,
        color: colors.ink.slice(1),
        margin: 0,
        valign: "top",
        breakLine: false,
        fit: "shrink",
      });
    slide.addShape(deck.ShapeType.line, {
      x: 0.75,
      y: height - 1.04,
      w: 8.5,
      h: 0,
      line: { color: colors.line.slice(1), width: 1.2 },
    });
    slide.addText(spec.brand.slice(0, 80), {
      x: 0.75,
      y: height - 0.84,
      w: 5.7,
      h: 0.42,
      fontFace: theme.bodyFont,
      fontSize: 14,
      color: colors.muted.slice(1),
      margin: 0,
    });
    slide.addText(`${index + 1} / ${slides.length}`, {
      x: 7.75,
      y: height - 0.84,
      w: 1.5,
      h: 0.42,
      align: "right",
      fontFace: theme.bodyFont,
      fontSize: 14,
      color: colors.muted.slice(1),
      margin: 0,
    });
  }
  const result = await deck.write({ outputType: "nodebuffer" });
  return Buffer.from(result as Buffer);
}
