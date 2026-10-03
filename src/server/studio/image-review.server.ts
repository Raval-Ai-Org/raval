import "server-only";
import { z } from "zod";
import { chatCompletion } from "@/lib/ai-gateway.server";
import { safeParseJson } from "@/lib/ai/json";

const ReviewSchema = z.object({
  status: z.enum(["pass", "warn"]),
  issues: z.array(z.string().trim().min(4).max(180)).max(3),
});

export type ImageReview = z.infer<typeof ReviewSchema>;
type ReviewCall = (dataUrl: string, brief: string) => Promise<string>;

const defaultCall: ReviewCall = async (dataUrl, brief) => {
  const response = await chatCompletion({
    route: "studio.image.review",
    task: "extraction",
    noCache: true,
    max_tokens: 350,
    timeoutMs: 15_000,
    retries: 0,
    retryOnTimeout: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Inspect this finished social media artwork against the brief below. Flag CLEARLY VISIBLE defects: focal subject contradicts the brief; prominent words misspelled, omitted or gibberish; unrequested words or logos; severe crop or unsafe margins; malformed product details; weak legibility or visual hierarchy at phone size. For a carousel or Story, check the exact supplied headline and safe zone. Do not infer unseen facts or reject merely because of subjective taste. If uncertain, pass. Return JSON only: {"status":"pass"|"warn","issues":string[]}. For pass, issues must be empty. Brief: ${brief.slice(0, 2400)}`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return String(response?.choices?.[0]?.message?.content ?? "");
};

/** Advisory only: an unavailable reviewer must never lose an already paid render. */
export async function reviewGeneratedImage(
  dataUrl: string,
  brief: string,
  call: ReviewCall = defaultCall,
): Promise<ImageReview | null> {
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) return null;
  try {
    const raw = await call(dataUrl, brief);
    const parsed = ReviewSchema.safeParse(safeParseJson<unknown>(raw, null));
    if (!parsed.success) return null;
    return parsed.data.status === "pass" || parsed.data.issues.length === 0
      ? { status: "pass", issues: [] }
      : { status: "warn", issues: parsed.data.issues };
  } catch (error) {
    console.warn(
      "[studio] image review unavailable",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
