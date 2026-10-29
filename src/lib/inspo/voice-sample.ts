// A sample line that changes as the voice sliders move. Pure string work, no
// model call: it only shows the direction of each setting, never real copy.

import type { WritingStyle } from "@/lib/brand-look/spec";

export function voiceSample(writing: WritingStyle | undefined, brandName?: string | null): string {
  const t = writing?.tone ?? {};
  const casual = t.casual ?? 50;
  const playful = t.playful ?? 50;
  const detailed = t.detailed ?? 50;
  const bold = t.bold ?? 50;
  const person = writing?.person ?? "we";
  const name = brandName?.trim() || "our shop";

  const subject = person === "i" ? "I" : person === "you" ? "You" : "We";
  const verb =
    person === "you" ? "can now try" : casual >= 60 ? "just dropped" : "are pleased to introduce";
  const opener = casual >= 70 ? "Hey friends! " : casual <= 30 ? "" : "";
  const thing = person === "you" ? `the new collection at ${name}` : "something new";
  let line = `${opener}${subject} ${verb} ${thing}`;
  if (detailed >= 65) line += ", made in small batches and ready to ship this week";
  if (playful >= 65) line += " (your weekend just got better)";
  line += bold >= 65 ? "!" : ".";
  if (bold >= 85) line = line.replace(/something new|the new collection/, (m) => m.toUpperCase());
  if (detailed <= 30) line = line.split(",")[0].replace(/[.!]?$/, bold >= 65 ? "!" : ".");

  const emoji = writing?.emoji === "heavy" ? " ✨🔥🙌" : writing?.emoji === "light" ? " ✨" : "";
  const tags = (writing?.hashtags?.always ?? [])
    .slice(0, 2)
    .map((h) => ` #${h}`)
    .join("");
  return `${line}${emoji}${tags}`;
}
