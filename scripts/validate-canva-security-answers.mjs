import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../docs/canva-security-form-answers.json", import.meta.url);
const { draftCharacterLimit, answers } = JSON.parse(readFileSync(source, "utf8"));
if (!Number.isInteger(draftCharacterLimit) || draftCharacterLimit < 1)
  throw new Error("Invalid draft limit");
const ids = new Set();
for (const { id, answer } of answers) {
  if (ids.has(id) || !answer || answer.length > draftCharacterLimit) {
    throw new Error(
      `Invalid answer ${id}: ${answer?.length ?? 0}/${draftCharacterLimit} characters`,
    );
  }
  ids.add(id);
}
if (process.argv.includes("--write")) {
  const header = `# Canva Security information: form drafts\n\nExact Portal questions and field limits were not supplied. These thematic answers are each at most ${draftCharacterLimit} characters, including spaces; this is a chosen draft limit, not a verified Canva field limit. Match them to the actual fields before submission.\n\n**Do not submit proposed-code controls as production facts until the new migration and application are deployed and verified.** Storage geography, backups, retention commitments and operational access controls still require your confirmation. The candid answers below identify missing evidence instead of inventing it. No Google/Canva approval or certification is claimed.\n\nOnly the paragraph under each heading is paste-ready; headings and counts are not part of the answer. Canonical text is in [the JSON file](canva-security-form-answers.json). Regenerate/check with \`node scripts/validate-canva-security-answers.mjs --write\`.\n\n`;
  writeFileSync(
    new URL("../docs/canva-security-form-answers.md", import.meta.url),
    header +
      answers
        .map(({ label, answer }) => `## ${label} (${answer.length} characters)\n\n${answer}\n`)
        .join("\n"),
  );
}
console.log(
  `Validated ${answers.length} answers; longest ${Math.max(...answers.map(({ answer }) => answer.length))}/${draftCharacterLimit} characters. Portal limits still require confirmation.`,
);
