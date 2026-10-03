// What works on each platform and in each format right now: the craft a good
// social lead already knows, written down once so every generator uses it.
//
// This is the steady layer (how a platform ranks and how people read it). The
// moving layer, what is working this month, is collected from the web and
// lives in trends.ts / social-trends.server.ts. Review this file when a
// platform changes how it works. Pure and browser-safe.
import type { PlatformId } from "@/lib/social-platforms";
import type { StudioType } from "./formats";

/** Last reviewed against published platform guidance and current studies. */
export const PLAYBOOK_REVIEWED = "2026-10";

export const PLATFORM_PLAYBOOK: Record<PlatformId, string[]> = {
  instagram: [
    "Saves and sends count for more than likes, so make it worth keeping or passing on.",
    "The first caption line works like a search title: name the topic in the words people would type.",
    "Carousels are read slide by slide; each swipe has to feel earned by the slide before it.",
    "Use 3 to 5 specific hashtags. More than that does not help.",
    "Stories reach the people who already follow you; replies to a Story land in your inbox and are the strongest signal there.",
  ],
  tiktok: [
    "People search here like a search engine: say the topic plainly in the first line and in any on-screen text.",
    "The first two seconds decide everything; open on the point, never on an introduction.",
    "One idea per post, said the way a person would say it out loud. Plain beats polished.",
    "Use 3 to 5 specific hashtags that describe the topic, not generic ones.",
  ],
  linkedin: [
    "The first two lines decide whether anyone taps to read more; put the tension or the result there.",
    "Lived detail beats general advice: what was tried, what happened, what changed.",
    "Close with a real question that invites a considered reply. No engagement bait such as 'comment YES'.",
    "Keep people on the post: no link in the opening lines. At most 3 hashtags.",
  ],
  twitter: [
    "One idea, stated plainly, readable in a glance.",
    "No hashtags unless one truly helps people find it.",
    "A clear opinion or a useful specific earns replies; a vague statement earns nothing.",
  ],
  threads: [
    "Conversational and direct, like a reply to a friend.",
    "Replies drive reach, so leave room for an answer: an opinion, a question, an unfinished thought.",
    "No hashtag walls; one topic tag at most.",
  ],
  facebook: [
    "Posts travel through shares and comments between people who know each other, so write for the person who will pass it on.",
    "A short, concrete story or a useful tip beats an announcement.",
    "1 to 2 hashtags at most.",
  ],
  youtube: [
    "The first line is read as a title: state the value in searchable words.",
    "Say what the viewer gets before anything about the brand.",
    "Up to 3 hashtags that match what people search for.",
  ],
};

export const FORMAT_PLAYBOOK: Partial<Record<StudioType, string[]>> = {
  carousel: [
    "The cover has one job: make the reader swipe. A specific promise or tension, never a topic label.",
    "Every slide carries one idea and hands over to the next, so the set reads as one piece.",
    "The second-to-last slide sums it up so the post is worth saving; the last asks for one action.",
  ],
  story: [
    "Each frame is seen for about five seconds: one idea, big words, read in a glance.",
    "The first frame decides whether people tap through; open on the point, never on a logo or a greeting.",
    "Ask for a reply rather than a like: replies come as direct messages and keep the conversation going.",
    "Keep text away from the top and bottom of the screen, where the app's controls sit.",
    "Links can't be stickered on Stories posted through an API: point people to the link in your bio.",
  ],
  social: [
    "The opening line has to work alone, cut off before 'more'.",
    "One point per post. A second point is a second post.",
  ],
  image: [
    "The picture carries the idea; the caption adds what the picture can't show.",
    "Readable at phone size in one second: one subject, one message.",
  ],
  video: [
    "The first frame is the hook; nothing builds up to it.",
    "Made for sound off as well as on.",
  ],
  script: [
    "Hook in the first two seconds, said and shown.",
    "Say the topic out loud early so the video can be found by search.",
    "One idea, a payoff the viewer can use, then one clear next step.",
  ],
  ad: ["Lead with the customer's situation, not the product.", "One offer, one action."],
};

/** The craft notes for a job: its format, then each platform it targets. */
export function playbookSection(type: StudioType, platforms: PlatformId[]): string {
  const lines: string[] = [];
  const format = FORMAT_PLAYBOOK[type];
  if (format?.length) lines.push(...format.map((l) => `- ${l}`));
  for (const id of platforms) {
    const notes = PLATFORM_PLAYBOOK[id];
    if (notes?.length) lines.push(`${id}:`, ...notes.map((l) => `- ${l}`));
  }
  return lines.join("\n");
}
