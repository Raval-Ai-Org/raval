import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { memeTemplate } from "@/lib/studio/memes/select";
import { drawMeme, memeTemplatePicture } from "@/server/studio/memes/render.server";

const OUT = process.env.BENCH_OUT ?? "H:/MelloxResearch/bench";
it("draws classic memes", async () => {
  for (const [id, lines] of [
    ["drake", ["writing captions at 2am", "letting the brand voice do it"]],
    [
      "gru",
      ["post every day", "follow the plan", "get followers", "forget to reply to any of them"],
    ],
    ["philosoraptor", ["if the sale never ends", "was it ever a sale"]],
  ] as const) {
    const t = memeTemplate(id)!;
    const pic = await memeTemplatePicture(t);
    const out = await drawMeme({ picture: pic!, template: t, lines });
    if (!out) throw new Error(`no render for ${id}`);
    writeFileSync(`${OUT}/memes/${id}.jpg`, out);
  }
}, 60_000);
