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

export type CreateIntent = { type: StudioType; brief: string };

// Imperative openers: "create …", "please write …", "can you make …", "I need a …".
const LEAD = String.raw`^(?:(?:hey|hi|ok(?:ay)?|so|now|please|pls|mellox)[,!\s]+)*`;
const VERB = String.raw`(?:create|make|generate|write|draft|design|produce|build|craft|compose|prepare|give\s+me|turn\s+(?:this|it|that)\s+into)\b`;
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
