// Does a chat message ask Mellox to MAKE something Studio can make?
//
// "Create a carousel about our summer menu" should start that carousel in
// Studio straight away, the way NotebookLM starts an audio overview — no
// composer pop-up, no extra confirmation. "What makes a good carousel?" must
// not. So a match needs both a making verb aimed at the request and a format
// Studio knows (detectStudioType). Pure and conservative: no match means the
// message is an ordinary chat turn.
import { detectStudioType } from "@/lib/studio/detect";
import type { StudioType } from "@/lib/studio/formats";
import { asksForDesign } from "@/lib/studio/photo-design/mode";

export type CreateIntent = { type: StudioType; brief: string };
export type AttachedImageMode = "preserve" | "design" | "edit" | "inspire";

// Imperative openers: "create …", "please write …", "can you make …", "I need a …".
const LEAD = String.raw`^(?:(?:hey|hi|ok(?:ay)?|so|now|please|pls|mellox)[,!\s]+)*`;
const VERB = String.raw`(?:create|make|generate|write|draft|design|produce|build|craft|compose|prepare|give\s+me|turn\s+(?:this|it|that)\s+into|(?:repurpose|reuse|convert)\s+(?:this|it|that))\b`;
const MAKE_REQUEST = new RegExp(
  LEAD +
    "(?:" +
    // "create …", "can you please write …", "let's make …", "help me draft …"
    String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:you\s+to\s+)?|let'?s\s+|help\s+me\s+|go\s+(?:ahead\s+and\s+)?)?` +
    VERB +
    // "I need a video script …", "I want an ad …"
    String.raw`|i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:a|an|some|\d+)\s` +
    ")",
  "i",
);

// Questions and advice requests about a format are chat, not a job.
const ASKING_ABOUT =
  /^(?:what|why|how|when|where|which|who|should|is|are|does|do|explain|tell\s+me\s+about|compare|review|analy[sz]e|audit|critique|improve\s+my\s+strategy)\b/i;

const MIN_BRIEF = 12;

export function detectCreateIntent(text: string): CreateIntent | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < MIN_BRIEF || t.length > 4000) return null;
  if (ASKING_ABOUT.test(t)) return null;
  // A question is chat, unless it's a polite request ("can you write …?").
  if (t.endsWith("?") && !/^(?:(?:please|pls)\s+)?(?:can|could|would|will)\s+you\b/i.test(t))
    return null;
  if (!MAKE_REQUEST.test(t)) return null;
  const type = detectStudioType(t);
  if (!type) return null;
  return { type, brief: t };
}

/** Commands that only make sense because an image is attached ("remove the background"). */
export function detectAttachedImageIntent(text: string): CreateIntent | null {
  const regular = detectCreateIntent(text);
  if (regular) return regular;
  const prompt = text.replace(/\s+/g, " ").trim();
  if (prompt.length < 3 || prompt.length > 4000 || ASKING_ABOUT.test(prompt)) return null;
  // "This is my team at work, add text and elements": a design asked for anywhere.
  if (asksForDesign(prompt)) return { type: "image", brief: prompt };
  if (
    !/^(?:(?:please|pls|now)\s+)*(?:(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+(?:you\s+to\s+)?|help\s+me\s+))?(?:edit|modify|retouch|change|remove|replace|swap|recolou?r|adjust|extend|erase|transform|add|put|place|overlay)\b/i.test(
      prompt,
    )
  )
    return null;
  return { type: "image", brief: prompt };
}

/** Clips attached with a making or branding request ("brand this clip", "add our logo"). */
export function detectAttachedClipIntent(text: string): CreateIntent | null {
  const prompt = text.replace(/\s+/g, " ").trim();
  if (prompt.length < 3 || prompt.length > 4000 || ASKING_ABOUT.test(prompt)) return null;
  if (
    !/\b(?:create|make|generate|design|produce|build|edit|brand|add|put|place|overlay|turn|use|post)\b/i.test(
      prompt,
    )
  )
    return null;
  return { type: "video", brief: prompt };
}

export type AttachedPhotoChoice = { mode: AttachedImageMode; fidelity?: "blend" };

const AS_IS =
  /\b(?:as (?:it )?is|unchanged|don'?t (?:change|edit|touch)|do not (?:change|edit|touch)|no changes|exactly as)\b/;
const INSPIRE =
  /\b(?:inspired by|use (?:it|this|the image|the photo) as (?:a )?(?:style|inspiration|reference)|match (?:its|the) (?:style|look)|create (?:a )?new (?:image|design)|reimagine|redesign)\b/;
const BLEND = /\b(?:blend|re-?draw|restyle|repaint|illustrat(?:e|ed|ion)|cartoon|painted)\b/;
const LOGO_ONLY = /\b(?:add|put|place|include)\b.{0,40}\blogo\b/;
const EDIT =
  /\b(?:edit|modify|retouch|change|remove|replace|swap|recolou?r|adjust|extend|erase|transform|add|put|place)\b/;

/**
 * How attached photos are used. Asking for words or design elements on a
 * photo designs around it, with the photo itself kept exact; only blending
 * words let the model repaint. Several photos for one post are a design. A
 * photo is never redrawn unless the words ask for it.
 */
export function attachedPhotoChoice(text: string, photos = 1): AttachedPhotoChoice {
  const prompt = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (AS_IS.test(prompt)) return { mode: "preserve" };
  if (INSPIRE.test(prompt)) return { mode: "inspire" };
  if (BLEND.test(prompt)) return { mode: "design", fidelity: "blend" };
  if (asksForDesign(prompt) || photos > 1) return { mode: "design" };
  // The real logo is placed by code on a photo posted as is.
  if (LOGO_ONLY.test(prompt)) return { mode: "preserve" };
  if (EDIT.test(prompt)) return { mode: "edit" };
  return { mode: "preserve" };
}

export function attachedImageMode(text: string): AttachedImageMode {
  return attachedPhotoChoice(text).mode;
}

// Strategy and analysis turns get more reasoning on the premium chat model
// (the `chat.pro` escalation in src/server/ai/task-models.ts). Pure and cheap:
// a keyword read of the newest user turn, never a model call.
const STRATEGY =
  /\b(?:strateg(?:y|ies|ic)|analy[sz](?:e|is|ing)|audit|diagnos(?:e|is)|positioning|go[\s-]to[\s-]market|gtm|roadmap|forecast|prioriti[sz]e|trade-?offs?|compare|competitors?|pricing\s+model|why\s+(?:is|are|did|does|do)|what\s+should\s+(?:i|we))\b/i;

export function isStrategyTurn(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length >= 12 && STRATEGY.test(t);
}

// "Turn this into a carousel", "make a Story from it", "repurpose my last post
// as an article": a new piece made from the one chat just made. The words that
// point back are taken out before the format is read, so "my last post" never
// makes the new piece a post.
const BACK_NOUN = String.raw`(?:one|post|piece|picture|image|photo|carousel|story|ad|article|script|video|caption)`;
// Longest first, so "this carousel" is taken out whole.
const BACK = String.raw`(?:th(?:is|at)\s+${BACK_NOUN}|(?:the|my)\s+(?:last|latest|same|previous|new)\s+${BACK_NOUN}|this|it|that)`;
const BACK_REF = new RegExp(
  // Only when nothing new follows: "from this list: …" brings its own material.
  String.raw`\b(?:turn|convert|change|repurpose|reuse|rework|adapt|from|out\s+of|based\s+on|using)\s+${BACK}(?=\s*$|\s*[.,!?]|\s+(?:in|into|as|to|for|and|too|please|now)\b)`,
  "i",
);

const REWORK_REQUEST = new RegExp(
  LEAD +
    String.raw`(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:turn|convert|change|repurpose|reuse|rework|adapt)\b`,
  "i",
);

/** Does the message ask for a new piece built from the last one? */
export function refersToLastPiece(text: string): boolean {
  return BACK_REF.test(text.replace(/\s+/g, " ").trim());
}

export function detectRepurposeIntent(text: string): CreateIntent | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < MIN_BRIEF || t.length > 4000 || ASKING_ABOUT.test(t)) return null;
  if (t.endsWith("?") && !/^(?:(?:please|pls)\s+)?(?:can|could|would|will)\s+you\b/i.test(t))
    return null;
  if (!MAKE_REQUEST.test(t) && !REWORK_REQUEST.test(t)) return null;
  const back = t.match(BACK_REF);
  if (!back) return null;
  const rest = t.replace(back[0], " ");
  // Here "a story" can only mean the Story format.
  const type = /\bstor(?:y|ies)\b/i.test(rest) ? "story" : detectStudioType(rest);
  return type ? { type, brief: t } : null;
}
