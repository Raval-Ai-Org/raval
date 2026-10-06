/** Only unambiguous user requests may start a paid Studio job from Slack. */
export function studioIntent(text: string) {
  const clean = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  const match =
    /^(?:please\s+)?(?:create|write|draft|make|turn)\s+(?:me\s+)?(?:this\s+into\s+)?(?:a\s+|an\s+)?(linkedin|instagram|x)\s+(post|thread|carousel)\b/i.exec(
      clean,
    );
  if (!match || clean.length < 20) return null;
  const platform = match[1].toLowerCase() === "x" ? "twitter" : match[1].toLowerCase();
  const kind = match[2].toLowerCase();
  if (kind === "carousel" && platform !== "instagram") return null;
  if (kind === "thread" && platform !== "twitter") return null;
  return {
    type: kind === "carousel" ? ("carousel" as const) : ("social" as const),
    platform: platform as "linkedin" | "instagram" | "twitter",
    brief: clean.slice(0, 3900),
    length: kind === "thread" ? ("long" as const) : ("standard" as const),
    needsSource: /^\s*(?:please\s+)?turn\s+this\s+into/i.test(clean),
  };
}
