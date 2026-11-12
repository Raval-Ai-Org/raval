// Who plays which role in a format. Pure. The person picked in the composer
// plays the format's lead; a two-person format's other role is the second
// creator picked, else a ready-made creator chosen by code to contrast with
// the lead (a different person, ideally of the other gender, a similar age).

import { STOCK_CREATORS, creatorPhotoPath, stockCreator, type StockCreator } from "../creators";
import type { UgcFormat } from "./types";

/** The role the picked creator plays: the one with the most screen time. */
export function leadRole(format: UgcFormat): "A" | "B" {
  const time = { A: 0, B: 0 };
  for (const beat of format.beats) if (beat.speaker !== "none") time[beat.speaker] += beat.share;
  // An off-camera interviewer is never the lead.
  const offCamera = format.roles.find((r) => /off-camera/i.test(r.position))?.key;
  if (offCamera === "A") return "B";
  return time.B > time.A ? "B" : "A";
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

const AGE_ORDER = ["18-24", "25-34", "35-44", "45-60"];

/**
 * A second creator for a two-person format: never the lead, the other gender
 * when the lead is known, a near age, and creators with a photo first.
 */
export function pickPartner(leadId: string | null | undefined, seed: string): StockCreator {
  const lead = stockCreator(leadId);
  const pool = STOCK_CREATORS.filter((c) => c.id !== lead?.id);
  const scored = pool.map((c) => {
    let score = creatorPhotoPath(c.id) ? 3 : 0;
    if (lead && c.gender !== lead.gender) score += 2;
    if (lead) {
      const gap = Math.abs(AGE_ORDER.indexOf(c.age) - AGE_ORDER.indexOf(lead.age));
      score += gap === 0 ? 2 : gap === 1 ? 1 : 0;
    }
    return { c, score };
  });
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best).map((s) => s.c);
  return top[hash(`${seed}:${lead?.id ?? ""}`) % top.length];
}
