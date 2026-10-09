import { getPostIndex } from "@/marketing/lib/blog-index";
import { buildLlmsTxt } from "@/marketing/lib/llms";

export const dynamic = "force-static";

/** /llms.txt: a short, curated map of the site for AI assistants (https://llmstxt.org). */
export async function GET() {
  const body = buildLlmsTxt(await getPostIndex());
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
