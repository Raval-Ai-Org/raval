import marketingSitemap from "@/marketing/sitemap";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]!);
}

export async function GET() {
  const entries = await marketingSitemap();
  const urls = entries.map((entry) => [
    "  <url>",
    `    <loc>${escapeXml(entry.url)}</loc>`,
    entry.lastModified ? `    <lastmod>${new Date(entry.lastModified).toISOString()}</lastmod>` : "",
    entry.changeFrequency ? `    <changefreq>${entry.changeFrequency}</changefreq>` : "",
    entry.priority !== undefined ? `    <priority>${entry.priority}</priority>` : "",
    "  </url>",
  ].filter(Boolean).join("\n"));

  return new Response([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
  ].join("\n"), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
