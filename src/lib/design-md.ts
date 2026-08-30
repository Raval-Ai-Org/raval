import type { BrandDna } from "@/hooks/use-brand-dna";

const KEY = (workspaceId: string) => `design-md:${workspaceId}`;

export function buildDesignMd(dna: BrandDna): string {
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Design.md`);
  lines.push("");
  lines.push(`> Auto-synced from Brand DNA · ${today}`);
  if (dna.websiteUrl) lines.push(`> Source: ${dna.websiteUrl}`);
  lines.push("");

  lines.push(`## Brand`);
  lines.push(`- **Name:** ${dna.brandName || "—"}`);
  if (dna.oneLiner) lines.push(`- **Tagline:** ${dna.oneLiner}`);
  if (dna.industry) lines.push(`- **Industry:** ${dna.industry}`);
  if (dna.businessModel) lines.push(`- **Business model:** ${dna.businessModel}`);
  if (dna.about) {
    lines.push("");
    lines.push(dna.about);
  }
  lines.push("");

  if (dna.colors.length) {
    lines.push(`## Color tokens`);
    lines.push("");
    lines.push(`| Token | Hex | Sample |`);
    lines.push(`| --- | --- | --- |`);
    for (const c of dna.colors) {
      lines.push(
        `| ${c.name} | \`${c.hex.toUpperCase()}\` | ![](https://singlecolorimage.com/get/${c.hex.replace("#", "")}/40x16) |`,
      );
    }
    lines.push("");
  }

  if (dna.fonts.length) {
    lines.push(`## Typography`);
    dna.fonts.forEach((f, i) => {
      const role = i === 0 ? "Display" : i === 1 ? "Body" : "Mono";
      lines.push(`- **${role}:** ${f}`);
    });
    lines.push("");
  }

  if (dna.logoUrl) {
    lines.push(`## Logo`);
    lines.push(`![logo](${dna.logoUrl})`);
    lines.push("");
  }

  if (dna.voice || dna.values) {
    lines.push(`## Voice & values`);
    if (dna.voice) lines.push(`- **Voice:** ${dna.voice}`);
    if (dna.values) lines.push(`- **Values:** ${dna.values}`);
    if (dna.valueTags.length) lines.push(`- **Tags:** ${dna.valueTags.join(", ")}`);
    lines.push("");
  }

  if (dna.audience || dna.audienceTags.length) {
    lines.push(`## Audience`);
    if (dna.audience) lines.push(`- ${dna.audience}`);
    if (dna.audienceTags.length) lines.push(`- **Segments:** ${dna.audienceTags.join(", ")}`);
    lines.push("");
  }

  if (dna.products) {
    lines.push(`## Products & offers`);
    lines.push(dna.products);
    lines.push("");
  }

  if (dna.doRules || dna.dontRules) {
    lines.push(`## Brand rules`);
    if (dna.doRules) {
      lines.push(`### Always do`);
      lines.push(dna.doRules);
      lines.push("");
    }
    if (dna.dontRules) {
      lines.push(`### Never do`);
      lines.push(dna.dontRules);
      lines.push("");
    }
  }

  if (dna.socials.length) {
    lines.push(`## Channels`);
    for (const s of dna.socials) lines.push(`- **${s.platform}:** ${s.url}`);
    lines.push("");
  }

  if (Object.keys(dna.sources).length) {
    lines.push(`## Sources`);
    for (const [field, src] of Object.entries(dna.sources)) {
      const tail = src.snippet ? ` — "${src.snippet}"` : "";
      lines.push(`- **${field}:** ${src.label}${tail}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function saveDesignMd(workspaceId: string, content: string) {
  try {
    localStorage.setItem(KEY(workspaceId), content);
  } catch {}
}

export function loadDesignMd(workspaceId: string): string | null {
  try {
    return localStorage.getItem(KEY(workspaceId));
  } catch {
    return null;
  }
}

export function downloadDesignMd(content: string, filename = "Design.md") {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
