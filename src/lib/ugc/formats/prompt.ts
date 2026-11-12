// The video prompt for a library format. Deterministic and pure: the same
// format, script and settings always give the same prompt.
//
// It follows the shape of the format's gold example (examples.ts): a real
// phone video of a named kind of Reel, who holds the phone, the light, the
// place in concrete detail, each person with their look and behaviour, a
// timed shot list with its cuts and the exact quoted lines, then the sound.
// It never calls the video an ad. Words on screen are drawn later by code.

import { creatorPrompt, stockCreator } from "../creators";
import { CREATOR_VIBES, LANGUAGES, labelOf } from "../options";
import {
  aspectPhrase,
  fitScenes,
  fmt,
  productDirection,
  scriptFacts,
  sentence,
  truncate,
  type PromptInput,
} from "../prompt";
import type { Brief, Scene } from "../schemas";
import { leadRole, pickPartner } from "./cast";
import { ugcFormat } from "./formats";
import type { BeatCut, FormatRole, Speaker, UgcFormat } from "./types";
import { variantOf } from "./variant";

/** The library format a render follows, or null for the classic creator prompt. */
export function formatForRender(
  brief: Pick<Brief, "format" | "scriptSource">,
  script: { format?: string } | null | undefined,
): UgcFormat | null {
  if (brief.scriptSource === "studio") return null;
  return ugcFormat(script?.format) ?? (brief.format !== "auto" ? ugcFormat(brief.format) : null);
}

const REALISM =
  "REALISM: it must look like a real person filmed it on a phone and posted it: real skin with pores, natural imperfect framing, everyday clothes, no beauty filter, no studio lighting, no ring-light catchlights, no stock-footage polish, no slow motion, no drone or crane shots.";
const TELLS =
  "Avoid the marks of AI video: faces, hands or products that change shape between shots, extra or merging fingers, people who change face or clothes, drifting or melting logos, garbled letters, objects that appear from nowhere, impossible camera moves, simulated app screens.";

const EDIT_LINE: Record<UgcFormat["edit"], string> = {
  "hard-cuts":
    "The video is edited with fast hard cuts, about every 1.5 to 2.5 seconds, no dead air:",
  "split-open":
    "It opens on a split screen, then fast hard cuts about every 1.5 to 2 seconds, no dead air:",
  "jump-cuts": "Jump cuts in the same framing remove every pause, no dead air:",
  continuous: "Mostly one continuous take, natural and unbroken:",
  montage: "A quick montage of short phone clips, 1 to 1.5 seconds each:",
};

/** The description of whoever plays a role. */
function castLine(
  role: FormatRole,
  who: { refIndex?: number; stockId?: string; brief?: Brief; contrast?: boolean },
): string {
  const stock = stockCreator(who.stockId);
  const parts: string[] = [];
  if (who.refIndex) {
    parts.push(
      `the person in reference image ${who.refIndex}, exactly as they look there: same face, hair, skin tone and build${stock ? `. ${creatorPrompt(stock)}` : "."}`,
    );
  } else if (stock) {
    parts.push(creatorPrompt(stock));
  } else if (who.brief) {
    const b = who.brief;
    const gender =
      b.creator.gender === "woman" ? "woman" : b.creator.gender === "man" ? "man" : "person";
    const age = b.creator.age === "any" ? "" : ` aged ${b.creator.age.replace("-", " to ")}`;
    const vibe = CREATOR_VIBES.find((v) => v.id === b.creator.vibe)?.prompt ?? "";
    parts.push(`an everyday ${gender}${age}${vibe ? `, ${vibe}` : ""}, casual clothes.`);
  } else {
    parts.push(
      `an everyday person${who.contrast ? " who looks clearly different from the other person" : ""}, casual clothes.`,
    );
  }
  return `${role.title} (${role.position}): ${parts.join(" ")} ${sentence(role.behaviour)}`;
}

function cutLabel(cut: BeatCut | undefined, shot: string, first: boolean): string {
  const s = shot.trim().replace(/\.$/, "");
  if (!s) return first ? "" : cut === "hard" ? "HARD CUT." : "";
  const lower = s[0].toLowerCase() + s.slice(1);
  switch (first ? (cut === "split" ? "split" : "open") : cut) {
    case "split": {
      const rest = s.replace(/^split screen[,:]?\s*/i, "");
      return `SPLIT SCREEN${rest ? `, ${rest}` : ""}.`;
    }
    case "hard":
      return `HARD CUT to ${lower}.`;
    case "continuous":
      return `Same take, ${lower}.`;
    default:
      return `${s}.`;
  }
}

/** The line a beat's speaker says, named by their role. */
function lineFor(scene: Scene, format: UgcFormat, roles: Map<Speaker, FormatRole>): string {
  const text = scene.dialogue.trim().replace(/"/g, "'");
  if (!text) return "No speech in this beat.";
  if (format.speech === "voiceover") return `Voiceover: "${text}"`;
  const speaker = roles.get(scene.speaker ?? "A") ?? format.roles[0];
  return `${speaker?.title ?? "The creator"} says: "${text}"`;
}

/** The cut a beat starts with: the script's own, else the format's beat at that place. */
function sceneCut(scene: Scene, index: number, total: number, format: UgcFormat): BeatCut {
  if (scene.cut) return scene.cut;
  if (index === 0) return format.beats[0]?.cut === "split" ? "split" : "open";
  const at = Math.min(format.beats.length - 1, Math.round((index / total) * format.beats.length));
  return format.beats[at]?.cut ?? "hard";
}

export function buildFormatVideoPrompt(input: PromptInput, format: UgcFormat): string {
  const { brief, product, durationSec, aspectRatio } = input;
  const scenes = fitScenes(input.script.scenes, durationSec);
  const variant = variantOf(format, input.script.variant);
  const language = labelOf(LANGUAGES, brief.language);
  const lead = leadRole(format);
  const imageMode = input.imageCount > 0 ? input.model.images?.mode : undefined;
  const leadRef = !!input.creatorImage && imageMode === "references";
  const partnerRef = leadRef && !!input.partnerImage;
  const personRefs = (leadRef ? 1 : 0) + (partnerRef ? 1 : 0);
  const partnerId =
    input.partnerId ??
    brief.creator.partnerId ??
    (format.roles.length === 2
      ? pickPartner(brief.creator.characterId, input.seed ?? format.id).id
      : undefined);
  const roles = new Map<Speaker, FormatRole>(format.roles.map((r) => [r.key, r]));

  const lines: string[] = [];
  lines.push(
    `Real ${aspectPhrase(aspectRatio)} smartphone video, ${format.show}, raw social-media footage, not cinematic, not an advertisement. ${durationSec} seconds. ${format.camera}. ${variant.place.light}, ${format.look.charAt(0).toLowerCase()}${format.look.slice(1)}. ${sentence(variant.place.set)}`,
  );
  lines.push("");

  if (!format.roles.length) {
    lines.push(
      "Only hands are in frame: natural hands with short clean nails and no jewellery, moving slowly and precisely. No face.",
    );
  } else {
    if (format.roles.length === 2)
      lines.push(
        "Two different people with clearly different faces, hair and clothes; each keeps their own look in every shot.",
      );
    for (const role of format.roles) {
      const isLead = role.key === lead;
      lines.push(
        castLine(
          role,
          isLead
            ? {
                refIndex: leadRef ? 1 : undefined,
                stockId: brief.creator.characterId,
                brief: brief.creator.characterId ? undefined : brief,
              }
            : { refIndex: partnerRef ? 2 : undefined, stockId: partnerId, contrast: true },
        ),
      );
    }
    if (brief.audience)
      lines.push(`They feel like people the audience (${truncate(brief.audience, 160)}) knows.`);
  }
  lines.push("");

  lines.push(`${productDirection(input, personRefs)} ${sentence(format.productRole)}`);
  const facts = scriptFacts(product, input.script);
  if (facts.length)
    lines.push(`TRUE PRODUCT FACTS (only these may be claimed): ${facts.join("; ")}.`);
  if (input.brandVoice) lines.push(`BRAND VOICE: ${truncate(input.brandVoice, 200)}.`);
  if (input.styleNotes)
    lines.push(
      `BRAND COLOURS AND MOOD (keep it phone footage): ${truncate(input.styleNotes, 300)}.`,
    );
  if (brief.instructions) lines.push(`CREATIVE NOTES: ${truncate(brief.instructions, 400)}`);
  lines.push("");

  lines.push(EDIT_LINE[format.edit]);
  scenes.forEach((scene, i) => {
    const cut = sceneCut(scene, i, scenes.length, format);
    const parts = [`[${fmt(scene.start)}–${fmt(scene.end)}s]`];
    const label = cutLabel(cut, scene.shot, i === 0);
    if (label) parts.push(label);
    if (scene.action) parts.push(sentence(scene.action));
    if (scene.productPlacement) parts.push(`Product: ${sentence(scene.productPlacement)}`);
    parts.push(lineFor(scene, format, roles));
    lines.push(parts.join(" "));
  });
  lines.push(
    "The first 1.5 seconds already hold the hook: no intro, no logo, no fade from black. The last beat lands the payoff and the video ends there.",
  );
  lines.push("");

  const voices =
    format.speech === "none"
      ? "No speech at all."
      : format.speech === "voiceover"
        ? `One close, quiet voiceover speaks only the quoted lines, word for word, in ${language}.`
        : `Each person speaks only their quoted lines, word for word, in ${language}, in a natural conversational voice with accurate lip sync: never announcer-style, never a voice-over.`;
  lines.push(`Sound: ${sentence(format.sound)} ${voices}`);
  lines.push("");

  lines.push(REALISM);
  lines.push(TELLS);
  const usesSplit = format.edit === "split-open" || format.beats.some((b) => b.cut === "split");
  lines.push(
    `DO NOT INCLUDE: no words, captions, subtitles, stickers, titles or watermarks drawn on screen (text is added later); no logos except those printed on the product itself; no other brands or competitor products; no invented features, results, prices or statistics${usesSplit ? "" : "; no split screens"}.`,
  );
  return lines.join("\n");
}
