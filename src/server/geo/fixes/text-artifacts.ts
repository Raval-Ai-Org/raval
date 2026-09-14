// text-artifacts.ts — deterministic contents for the discovery files a fix
// creates or updates: robots.txt, llms.txt and sitemap.xml. No model call and
// nothing invented: every URL, title and description comes from the scan.
//
// Pure; returns the new file text or a reason the change can't be made safely.

import { AI_BOTS, parseRobotsAllow, robotsSitemaps } from "@/lib/geo/robots";
import type { PageAnalysis, SiteArtifacts } from "@/lib/geo/types";

export type ArtifactResult =
  { ok: true; content: string; summary: string } | { ok: false; reason: string };

export type CrawledPageFacts = {
  url: string;
  title: string | null;
  description: string | null;
  pageType: PageAnalysis["pageType"];
  noindex: boolean;
};

const HEADER = "# Reviewed and proposed by Mellox AI Visibility.";

function sitemapUrlFor(site: SiteArtifacts): string | null {
  if (!site.sitemap.found) return null;
  return site.sitemap.sources[0] ?? `${site.origin}/sitemap.xml`;
}

/* ───────────────────────── robots.txt ───────────────────────── */

/**
 * `bot` set: make exactly that AI crawler allowed, touching only the lines that
 * block it. No bot: publish a permissive robots.txt (when none exists) or add
 * the sitemap declaration.
 */
export function buildRobotsTxt(input: {
  site: SiteArtifacts;
  existing: string | null;
  bot?: string | null;
  addSitemap?: boolean;
}): ArtifactResult {
  const sitemap = sitemapUrlFor(input.site);
  const existing = input.existing ?? "";

  if (input.addSitemap) {
    if (!sitemap)
      return { ok: false, reason: "Publish a valid sitemap first, then declare it in robots.txt." };
    if (!existing.trim()) {
      return {
        ok: true,
        content: `${HEADER}\nUser-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`,
        summary: `Creates robots.txt that allows all crawlers and declares ${sitemap}.`,
      };
    }
    if (robotsSitemaps(existing).length) {
      return {
        ok: false,
        reason:
          "robots.txt in the repository already declares a sitemap — the live site may not be deployed from this branch.",
      };
    }
    const content = `${existing.replace(/\s*$/, "")}\n\nSitemap: ${sitemap}\n`;
    return { ok: true, content, summary: `Adds “Sitemap: ${sitemap}” to the end of robots.txt.` };
  }

  if (input.bot) {
    const bot = AI_BOTS.find((b) => b.id.toLowerCase() === input.bot!.toLowerCase());
    if (!bot) return { ok: false, reason: "Unknown crawler." };
    if (!existing.trim()) {
      return {
        ok: false,
        reason: "The repository has no robots.txt, so it isn't what blocks this crawler.",
      };
    }
    if (parseRobotsAllow(existing, bot.id) !== "block") {
      return {
        ok: false,
        reason: `robots.txt in the repository already allows ${bot.id} — the live file comes from somewhere else.`,
      };
    }
    const lines = existing.split(/\r?\n/);
    const agentLine = (l: string) => /^\s*user-agent\s*:\s*(.+?)\s*(#.*)?$/i.exec(l);
    let removed = 0;
    // 1) Drop the bot from any group that names it explicitly.
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = agentLine(lines[i]);
      if (m && m[1].toLowerCase() === bot.id.toLowerCase()) {
        // Is this the group's only user-agent? Then drop the whole group.
        let j = i + 1;
        const groupAgents = [i];
        let k = i - 1;
        while (k >= 0 && agentLine(lines[k])) groupAgents.unshift(k--);
        while (j < lines.length && agentLine(lines[j])) groupAgents.push(j++);
        if (groupAgents.length === 1) {
          // Skip directive lines until the next group or a blank line.
          while (j < lines.length && lines[j].trim() && !agentLine(lines[j])) j++;
          i = j - 1;
        }
        removed++;
        continue;
      }
      kept.push(lines[i]);
    }
    let content = kept.join("\n").replace(/\n{3,}/g, "\n\n");
    // 2) Still blocked (e.g. by `User-agent: *` / Disallow: /)? Add an explicit allow group.
    if (parseRobotsAllow(content, bot.id) === "block") {
      content = `${content.replace(/\s*$/, "")}\n\n# Let ${bot.who} read the site.\nUser-agent: ${bot.id}\nAllow: /\n`;
    } else if (!content.endsWith("\n")) {
      content += "\n";
    }
    if (parseRobotsAllow(content, bot.id) === "block") {
      return {
        ok: false,
        reason: `Couldn't produce a robots.txt that allows ${bot.id}; review it manually.`,
      };
    }
    return {
      ok: true,
      content,
      summary: removed
        ? `Removes the rule that blocks ${bot.id}.`
        : `Adds an explicit “User-agent: ${bot.id} / Allow: /” group; other crawler rules are unchanged.`,
    };
  }

  if (existing.trim()) {
    return {
      ok: false,
      reason:
        "robots.txt already exists in the repository — the live site may not be deployed from this branch.",
    };
  }
  return {
    ok: true,
    content: `${HEADER}\nUser-agent: *\nAllow: /\n${sitemap ? `\nSitemap: ${sitemap}\n` : ""}`,
    summary: `Creates robots.txt that allows all crawlers${sitemap ? ` and declares ${sitemap}` : ""}.`,
  };
}

/* ───────────────────────── llms.txt ───────────────────────── */

const oneLine = (s: string | null, max: number) =>
  (s ?? "").replace(/\s+/g, " ").replace(/[[\]]/g, "").trim().slice(0, max);

export function buildLlmsTxt(input: {
  site: SiteArtifacts;
  brandName: string | null;
  summary: string | null;
  pages: CrawledPageFacts[];
}): ArtifactResult {
  const pages = input.pages
    .filter((p) => !p.noindex && p.title && p.pageType !== "legal")
    .slice(0, 60);
  if (!pages.length)
    return { ok: false, reason: "No indexable pages with titles were crawled to list." };
  const name = oneLine(input.brandName, 80) || input.site.host;
  const summary = oneLine(input.summary, 300);
  const byType = new Map<string, CrawledPageFacts[]>();
  const label: Record<string, string> = {
    home: "Main pages",
    about: "Main pages",
    contact: "Main pages",
    other: "Pages",
    product: "Products",
    listing: "Pages",
    article: "Articles",
  };
  for (const p of pages) {
    const key = label[p.pageType] ?? "Pages";
    byType.set(key, [...(byType.get(key) ?? []), p]);
  }
  const sections = ["Main pages", "Products", "Pages", "Articles"]
    .filter((k) => byType.has(k))
    .map(
      (k) =>
        `## ${k}\n\n${byType
          .get(k)!
          .map((p) => {
            const desc = oneLine(p.description, 160);
            return `- [${oneLine(p.title, 100)}](${p.url})${desc ? `: ${desc}` : ""}`;
          })
          .join("\n")}`,
    );
  const content = `# ${name}\n\n${summary ? `> ${summary}\n\n` : ""}${sections.join("\n\n")}\n`;
  return {
    ok: true,
    content,
    summary: `Creates llms.txt listing ${pages.length} crawled page(s) with their real titles and descriptions.`,
  };
}

/* ───────────────────────── sitemap.xml ───────────────────────── */

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildSitemapXml(input: {
  site: SiteArtifacts;
  pages: CrawledPageFacts[];
}): ArtifactResult {
  const urls = [...new Set(input.pages.filter((p) => !p.noindex).map((p) => p.url))]
    .filter((u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, "") === input.site.host;
      } catch {
        return false;
      }
    })
    .slice(0, 5000);
  if (!urls.length) return { ok: false, reason: "No indexable pages were crawled to list." };
  const content =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return {
    ok: true,
    content,
    summary: `Creates sitemap.xml with the ${urls.length} indexable page(s) Mellox crawled. Pages it didn't reach aren't listed — review before merging.`,
  };
}
