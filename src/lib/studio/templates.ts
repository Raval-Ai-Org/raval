// Studio templates: proven structures per format. A template pre-fills the
// description with [blanks] to fill in, applies sensible settings, and — via
// `templateDirective` — tells the generator exactly how to build the piece.
// Pure (no React, no server) so the prompt engine and the UI share it.
//
// `label`, `tagline` and `beats` are what people read: plain everyday words.
// `directive` is sent to the model: as specific as it needs to be.
// Ids are stored on jobs and content rows — add templates, never rename ids.
import type { StudioType } from "./formats";
import type { GoalId, StudioControls } from "./jobs";

export type ThumbLayout =
  | "list"
  | "split"
  | "quote"
  | "steps"
  | "hero"
  | "story"
  | "question"
  | "compare"
  | "chat"
  | "countdown"
  | "play"
  | "grid";

export type StudioTemplate = {
  /** Globally unique, ≤ 40 chars — stored on jobs and content rows. */
  id: string;
  types: StudioType[];
  label: string;
  tagline: string;
  /** The structure, in order — shown to the user and sent to the model. */
  beats: string[];
  /** Description starter with [bracketed] blanks to fill in. */
  starter: string;
  /** How the model should build it. */
  directive: string;
  goal?: GoalId;
  controls?: Partial<StudioControls>;
  thumb: ThumbLayout;
};

/** Rules every template shares, appended to each directive. */
const HONESTY =
  "Only use facts, numbers, names and quotes that appear in the description or the brand details; if something is missing, write around it instead of inventing it.";

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  /* ───────────── Social post ───────────── */
  {
    id: "social-hot-take",
    types: ["social"],
    label: "Bold opinion",
    tagline: "Say what others won't — start a debate",
    beats: ["Bold statement", "Why", "Proof", "Question"],
    starter:
      "Share our honest opinion that [bold opinion] for [audience], backed by [proof or experience].",
    directive:
      "First line: one confident, specific opinion in under 12 words — no hedging words like 'maybe' or 'I think'. Second part: the single strongest reason, in plain language. Third part: one concrete proof point from real experience. Close with an open question that invites people to agree or push back. Short paragraphs of one or two sentences each; no hashtags in the body.",
    goal: "engagement",
    thumb: "quote",
  },
  {
    id: "social-behind-scenes",
    types: ["social"],
    label: "Behind the scenes",
    tagline: "Show how the work really gets done",
    beats: ["The moment", "What's happening", "Why it matters", "Invite"],
    starter:
      "Take people behind the scenes of [process or place] and show why [detail] makes our [product or service] better.",
    directive:
      "Write as an insider sharing a real moment. Open in the middle of the action with one vivid detail (a sound, a smell, a small ritual). Explain what most customers never see, then connect it directly to what the customer gets. End by inviting people to ask a question or visit. Warm, human and first-person plural; never corporate or boastful.",
    goal: "awareness",
    thumb: "story",
  },
  {
    id: "social-customer-story",
    types: ["social"],
    label: "Customer success",
    tagline: "How a customer went from stuck to sorted",
    beats: ["Before", "What changed", "Result", "Lesson"],
    starter:
      "Tell how [customer type] went from [problem] to [result] with [our product or service].",
    directive:
      "Tell a short story in four parts. Before: the customer's frustration in their own terms. What changed: the moment they tried something new, with the product in a supporting role, not as the hero. Result: a concrete, specific outcome. Lesson: one takeaway any reader can use even if they never buy. Keep names and figures exactly as given, and use a generic description (for example 'a local bakery owner') if none are provided.",
    goal: "leads",
    thumb: "compare",
  },
  {
    id: "social-tips",
    types: ["social"],
    label: "Quick tips",
    tagline: "Useful tips people save for later",
    beats: ["Opening", "Tip", "Tip", "Tip", "Save it"],
    starter: "Share [number] practical tips to help [audience] [achieve outcome].",
    directive:
      "Open with a line that promises a specific result (for example 'Cut your prep time in half'). Give 3–5 tips as a numbered or bulleted list; each tip starts with a verb, is one line, and is something the reader can do today. Avoid obvious advice. End with a short line asking people to save or share it.",
    goal: "education",
    thumb: "list",
  },
  {
    id: "social-announcement",
    types: ["social"],
    label: "Announcement",
    tagline: "Share news people can act on",
    beats: ["The news", "Main benefit", "Who it's for", "Next step"],
    starter:
      "Announce [launch or news]. It helps [audience] [benefit] and is available [when or where].",
    directive:
      "Lead with the news in the very first line — no warm-up. Follow with the one benefit that matters most to the customer, then who it is for, then exactly what to do next and where (link, store, date). Energetic but believable: no 'game-changer', 'revolutionary' or all-caps hype. Keep it under 120 words for most platforms.",
    goal: "launch",
    thumb: "hero",
  },
  {
    id: "social-ask-audience",
    types: ["social"],
    label: "Ask a question",
    tagline: "Get people talking in the comments",
    beats: ["Relatable moment", "Question", "Answer options"],
    starter: "Ask our audience about [topic]: do they prefer [option A] or [option B]?",
    directive:
      "Set up a relatable everyday situation in one or two lines so the question feels natural. Ask one clear question. Offer 2–4 short answer options people can reply with (letters, numbers or emojis). Keep it light and easy to answer in a few seconds; do not sell anything in this post.",
    goal: "engagement",
    thumb: "question",
  },
  {
    id: "social-milestone",
    types: ["social"],
    label: "Milestone thank-you",
    tagline: "Celebrate a win and thank your people",
    beats: ["The milestone", "The journey", "Thank you", "What's next"],
    starter:
      "Celebrate [milestone] and thank [customers, team or community] for [how they helped].",
    directive:
      "State the milestone plainly in the first line. Share one short, honest moment from the journey (a struggle or a turning point). Thank the people who made it happen, specifically. Close with a hint of what's next. Grateful and humble — focus on the community, not on bragging.",
    goal: "awareness",
    thumb: "countdown",
  },
  {
    id: "social-faq",
    types: ["social"],
    label: "Answer a common question",
    tagline: "The question customers ask most — answered",
    beats: ["The question", "Short answer", "Details", "Invite more"],
    starter: "Answer the question customers ask most about [topic]: [question].",
    directive:
      "Open with the question exactly as a customer would phrase it. Give the short answer in one sentence right away. Add 2–3 lines of helpful detail or an example. End by inviting people to ask their own questions in the comments. Friendly, clear, no jargon.",
    goal: "education",
    thumb: "chat",
  },

  /* ───────────── Carousel ───────────── */
  {
    id: "carousel-step-by-step",
    types: ["carousel"],
    label: "Step-by-step guide",
    tagline: "One step per slide, easy to follow",
    beats: ["Promise", "Step 1", "Step 2", "Step 3", "Recap"],
    starter: "A step-by-step guide to [outcome] for [audience], in [number] simple steps.",
    directive:
      "Slide 1: a headline that promises the outcome in under 8 words. One step per slide after that: a short action heading (starts with a verb) and one sentence of how-to. Steps must be in the order someone would actually do them. Final slide: a one-line recap and a prompt to save the post. Keep every slide readable in two seconds.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "steps",
  },
  {
    id: "carousel-myth-fact",
    types: ["carousel"],
    label: "Myths vs facts",
    tagline: "Clear up what people get wrong",
    beats: ["Opening", "Myth", "Fact", "Myth", "Fact", "Next step"],
    starter: "Bust [number] common myths about [topic] that [audience] still believe.",
    directive:
      "Slide 1 opens with the most surprising myth as a question or bold statement. Then alternate: a slide that states the myth plainly (label it 'Myth'), followed by a slide with the fact (label it 'Fact') and one concrete reason or example. Be kind — never make the reader feel stupid for believing it. Final slide: what to do instead, plus a follow or save prompt.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "compare",
  },
  {
    id: "carousel-mistakes",
    types: ["carousel"],
    label: "Mistakes to avoid",
    tagline: "Each slide: a mistake and how to fix it",
    beats: ["Opening", "Mistake", "Fix", "Mistake", "Fix", "Next step"],
    starter: "The [number] mistakes [audience] make with [topic], and how to fix each one.",
    directive:
      "Slide 1: '[Number] mistakes [audience] make with [topic]' in plain words. Each following slide names one mistake as the heading and gives the fix in one or two sentences. Order from most common to most costly. Final slide: a short encouraging line and a call to follow for more. Practical, not preachy.",
    goal: "education",
    controls: { slideCount: 7 },
    thumb: "list",
  },
  {
    id: "carousel-before-after",
    types: ["carousel"],
    label: "Before & after",
    tagline: "A transformation and what made it happen",
    beats: ["Opening", "Before", "What changed", "After", "Next step"],
    starter:
      "Show the before and after of [transformation] for [customer or project], and what made the difference.",
    directive:
      "Slide 1 teases the result. Paint a vivid, specific 'before' (what it looked, felt or cost like). The middle slides explain the 2–3 changes that made the difference, one per slide. Then a clear 'after' with the concrete outcome. Final slide invites the reader to get the same result. Specifics over superlatives.",
    goal: "leads",
    controls: { slideCount: 5 },
    thumb: "split",
  },
  {
    id: "carousel-checklist",
    types: ["carousel"],
    label: "Checklist",
    tagline: "A handy list people save for later",
    beats: ["Opening", "Item", "Item", "Item", "Save it"],
    starter: "A checklist for [audience] before they [task].",
    directive:
      "Slide 1: 'The [task] checklist' with who it's for. One checklist item per slide with a checkbox-style heading and a one-line reason it matters. Items in the order they should be checked. Final slide: 'Save this for next time' plus one encouraging line.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "list",
  },
  {
    id: "carousel-product-tour",
    types: ["carousel"],
    label: "Product tour",
    tagline: "Walk through what you offer, slide by slide",
    beats: ["Meet it", "Feature", "Feature", "Feature", "Get it"],
    starter:
      "A slide-by-slide tour of [product or service] for [audience], showing [key features].",
    directive:
      "Slide 1 introduces the product and the one problem it solves. Each middle slide shows one feature as a customer benefit ('You can…'), with a short example of it in real use. Final slide: price or offer if provided, and exactly how to get it. Visual-first: short text, clear headings.",
    goal: "launch",
    controls: { slideCount: 6 },
    thumb: "grid",
  },
  {
    id: "carousel-stats",
    types: ["carousel"],
    label: "Numbers that matter",
    tagline: "Key facts and figures, one per slide",
    beats: ["Opening", "Number", "Number", "Number", "What it means"],
    starter: "Share [number] eye-opening facts about [topic] that matter to [audience].",
    directive:
      "Slide 1 frames why these numbers matter. Each middle slide leads with one large number or fact and a one-line explanation of what it means for the reader. Use only figures provided in the description or brand details; if none are given, use clearly qualitative statements instead of made-up numbers. Final slide: what the reader should do with this.",
    goal: "awareness",
    controls: { slideCount: 5 },
    thumb: "countdown",
  },
  {
    id: "carousel-faq",
    types: ["carousel"],
    label: "Questions answered",
    tagline: "Your most common questions, one per slide",
    beats: ["Opening", "Question", "Question", "Question", "Ask us"],
    starter: "Answer the [number] questions [audience] ask most about [topic].",
    directive:
      "Slide 1: 'Your questions about [topic], answered'. Each middle slide has one question as the heading (phrased how customers actually ask) and a clear two-sentence answer. Final slide invites more questions in the comments or DMs.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "chat",
  },

  /* ───────────── Image post ───────────── */
  {
    id: "image-product-hero",
    types: ["image"],
    label: "Product showcase",
    tagline: "Your product, looking its best",
    beats: ["Product", "Setting", "Benefit"],
    starter: "A beautiful shot of [product] in [setting], highlighting [key benefit].",
    directive:
      "Image: the product is the clear hero, sharp and centred or on the rule of thirds, with soft premium lighting, a clean uncluttered background that hints at the setting, and brand colours as accents. No text baked into the image. Caption: lead with the single most compelling customer benefit, add one sensory or practical detail, and end with a simple next step.",
    goal: "launch",
    thumb: "hero",
  },
  {
    id: "image-quote-card",
    types: ["image"],
    label: "Quote card",
    tagline: "A line worth sharing",
    beats: ["Quote", "Who said it", "Why it matters"],
    starter: "A quote card with [quote or insight] from [person or brand], for [audience].",
    directive:
      "Image: a clean graphic with generous empty space in brand colours, designed to hold one short quote in large, legible type; keep backgrounds simple and high-contrast. Keep the quote exactly as given (under 20 words works best). Caption: one line of context on who said it and why it matters, then a question that invites reflection.",
    goal: "awareness",
    thumb: "quote",
  },
  {
    id: "image-lifestyle",
    types: ["image"],
    label: "Real-life moment",
    tagline: "Real people using what you offer",
    beats: ["Person", "Moment", "Feeling"],
    starter: "A real-life moment of [customer type] using [product] while [situation].",
    directive:
      "Image: a natural, candid photo-style moment of a person using the product in an everyday setting — natural light, relaxed body language, not posed or stock-looking; the product visible but not shoved into frame. Caption: describe the feeling and the moment, not the specs, in a warm conversational voice, and end with a gentle invitation.",
    goal: "awareness",
    thumb: "story",
  },
  {
    id: "image-offer",
    types: ["image"],
    label: "Sale or offer",
    tagline: "A deal people understand at a glance",
    beats: ["Offer", "Deadline", "Next step"],
    starter: "Promote [offer] for [audience], ending [deadline].",
    directive:
      "Image: bold, simple composition in brand colours with a clear focal area and clean space reserved for a short headline; the product or a symbol of the offer visible. Caption: first line states the offer plainly (what, how much, for whom), second line the deadline, then one clear action. Honest urgency only — use the real deadline given.",
    goal: "offer",
    thumb: "countdown",
  },
  {
    id: "image-review",
    types: ["image"],
    label: "Customer review",
    tagline: "Let a happy customer do the talking",
    beats: ["Review", "Who said it", "Try it"],
    starter: 'Share this customer review: "[review text]" from [customer name or type].',
    directive:
      "Image: a warm, trustworthy graphic that frames a short review, with a subtle star or speech-bubble motif in brand colours and plenty of empty space. Use the review wording exactly as provided. Caption: thank the customer, add one line on what they bought or experienced, and invite others to try it.",
    goal: "leads",
    thumb: "chat",
  },
  {
    id: "image-flat-lay",
    types: ["image"],
    label: "Styled flat lay",
    tagline: "A neat top-down arrangement",
    beats: ["Items", "Arrangement", "Story"],
    starter: "A top-down flat lay of [product] with [related items] in a [style] style.",
    directive:
      "Image: a top-down (overhead) flat lay on a clean textured surface, items arranged with balanced spacing, soft even light and a restrained colour palette matching the brand; the main product slightly larger or central. Caption: tell the small story the arrangement suggests (a morning routine, a gift, a weekend) and name what's included only if provided.",
    goal: "awareness",
    thumb: "grid",
  },
  {
    id: "image-tip-card",
    types: ["image"],
    label: "Tip card",
    tagline: "One helpful tip, beautifully simple",
    beats: ["Tip", "Why it works", "Save it"],
    starter: "A simple visual tip showing [audience] how to [small task or improvement].",
    directive:
      "Image: a minimal illustrated or graphic card with one clear visual idea representing the tip, lots of space, brand colours, no dense text. Caption: state the tip in one line, explain why it works in one or two lines, and ask people to save it.",
    goal: "education",
    thumb: "list",
  },
  {
    id: "image-event",
    types: ["image"],
    label: "Event invite",
    tagline: "Get people to show up",
    beats: ["What", "When & where", "Why come", "Sign up"],
    starter: "Invite [audience] to [event] on [date] at [place or link].",
    directive:
      "Image: an inviting scene or graphic that captures the atmosphere of the event, in brand colours, with clean space for a title. Caption: event name and one-line promise, then date, time and place on their own lines, then the top reason to come, then exactly how to register or RSVP. Use only the details given.",
    goal: "launch",
    thumb: "hero",
  },

  /* ───────────── Ad ───────────── */
  {
    id: "ad-problem-solution",
    types: ["ad"],
    label: "Problem & fix",
    tagline: "Name the problem, show the fix",
    beats: ["Problem", "Fix", "Proof", "Next step"],
    starter: "Show how [product] solves [specific problem] for [audience].",
    directive:
      "Each ad version opens on a sharply specific, relatable problem in the customer's words (not a generic pain like 'struggling?'). Present the product as the simple fix in one sentence, add one proof point, and end with a direct, low-effort call to action. Make each version test a different problem framing. Headlines under 40 characters; primary text under 125 characters for the first line.",
    goal: "leads",
    thumb: "split",
  },
  {
    id: "ad-social-proof",
    types: ["ad"],
    label: "Customer reviews",
    tagline: "Let happy customers sell for you",
    beats: ["Result or review", "Who it's for", "Next step"],
    starter: "Use [review, rating or result] to show [audience] why [product] is trusted.",
    directive:
      "Lead every version with the proof exactly as provided (rating, review quote, customer count or result) — never invent or round up figures. Follow with who it's for and the one benefit behind the praise, then a clear call to action. Vary which piece of proof leads across versions.",
    goal: "leads",
    thumb: "chat",
  },
  {
    id: "ad-limited-offer",
    types: ["ad"],
    label: "Limited-time offer",
    tagline: "An honest reason to act now",
    beats: ["Offer", "Why now", "Next step"],
    starter: "Drive sign-ups for [offer] before [deadline].",
    directive:
      "State the offer plainly in the first words (what they get and the price or discount if given). Give an honest reason to act now using the real deadline or limit provided. One clear call to action. Vary the angle across versions: savings, fear of missing out, and a simple reminder. No fake scarcity.",
    goal: "offer",
    thumb: "countdown",
  },
  {
    id: "ad-feature-spotlight",
    types: ["ad"],
    label: "Feature spotlight",
    tagline: "One feature, one clear benefit",
    beats: ["Feature", "Benefit", "Example", "Next step"],
    starter: "Spotlight [feature] and how it helps [audience] [outcome].",
    directive:
      "Turn one feature into a customer benefit ('so you can…'). Show it with a concrete everyday example of it in use. Headlines stay benefit-first, not feature names. End with a call to action that matches the benefit (for example 'Try it free').",
    goal: "awareness",
    thumb: "steps",
  },
  {
    id: "ad-comparison",
    types: ["ad"],
    label: "Us vs the old way",
    tagline: "Show why your way is better",
    beats: ["The old way", "The better way", "Proof", "Switch"],
    starter: "Compare [the old way or usual alternative] with [our product] for [audience].",
    directive:
      "Contrast the frustrating 'old way' (the usual alternative, never a named competitor) with how the product makes it easier, faster or cheaper. Use a clear side-by-side or 'Instead of X, just Y' structure. One proof point, then a call to action to switch. Confident but fair.",
    goal: "leads",
    thumb: "compare",
  },
  {
    id: "ad-launch",
    types: ["ad"],
    label: "New launch",
    tagline: "Introduce something new",
    beats: ["It's here", "What it does", "Who it's for", "Get it"],
    starter: "Launch [new product or feature] to [audience], available [when or where].",
    directive:
      "Open with a 'new' signal and the product name. Explain what it does in one benefit-led sentence, who it's made for, and how to get it now. Vary versions between curiosity, benefit and early-access angles. Excited but credible.",
    goal: "launch",
    thumb: "hero",
  },
  {
    id: "ad-retarget",
    types: ["ad"],
    label: "Come back reminder",
    tagline: "Win back people who were interested",
    beats: ["Remember us?", "What they'll miss", "Easy next step"],
    starter:
      "Remind people who looked at [product] but didn't buy, and give them [reason or offer].",
    directive:
      "Speak to someone who already knows the product and hesitated. Acknowledge it lightly ('Still thinking it over?'), remove one likely doubt (price, fit, delivery, trust) using details provided, and make the next step feel easy. Friendly, never pushy or guilt-tripping.",
    goal: "offer",
    thumb: "question",
  },
  {
    id: "ad-lead-magnet",
    types: ["ad"],
    label: "Free download or trial",
    tagline: "Offer something useful for free",
    beats: ["Free offer", "What's inside", "Who it's for", "Get it"],
    starter: "Offer [free guide, trial or sample] to help [audience] [outcome].",
    directive:
      "Lead with the word 'Free' and exactly what they get. List the 2–3 most valuable things inside or outcomes it delivers, say who it's for, and end with a one-step call to action (download, start, claim). Keep it clear that it is free and what, if anything, is required.",
    goal: "leads",
    thumb: "grid",
  },

  /* ───────────── AI video ───────────── */
  {
    id: "video-product-reveal",
    types: ["video"],
    label: "Product reveal",
    tagline: "Build excitement, then show it off",
    beats: ["Tease", "Reveal", "Final shot"],
    starter: "A cinematic reveal of [product], ending on a final shot with [setting or mood].",
    directive:
      "Shot plan: open on tight close-ups of textures and details that hint at the product, use a slow camera move (push-in or orbit), then reveal the full product in a clean, well-lit final shot with the brand colours in the background. Smooth, cinematic motion; no on-screen text in the video. Captions tease in the first line, then name the product and its main benefit.",
    goal: "launch",
    controls: { durationSec: 6 },
    thumb: "play",
  },
  {
    id: "video-process",
    types: ["video"],
    label: "How it's made",
    tagline: "A satisfying look at the making",
    beats: ["Start", "Making", "Finished"],
    starter: "Show the process of making [product], from [start] to [finished result].",
    directive:
      "Shot plan: raw materials in soft light, then hands at work with close, tactile detail and steady motion, then the finished result presented proudly. Keep movement smooth and satisfying, with a warm, natural colour grade. Captions highlight the care and craft involved, in plain words.",
    goal: "awareness",
    controls: { durationSec: 8 },
    thumb: "steps",
  },
  {
    id: "video-transformation",
    types: ["video"],
    label: "Before & after",
    tagline: "A striking transformation",
    beats: ["Before", "Change", "After"],
    starter: "A before-and-after transformation of [subject] using [product or service].",
    directive:
      "Shot plan: a clear, slightly dull 'before' state, a smooth transition (wipe, whip-pan or morph), and a bright, striking 'after' from the same camera angle so the change is obvious. Captions state the change in concrete terms and invite viewers to get the same result.",
    goal: "leads",
    controls: { durationSec: 6 },
    thumb: "split",
  },
  {
    id: "video-mood-broll",
    types: ["video"],
    label: "Brand mood",
    tagline: "A feeling that captures your brand",
    beats: ["Atmosphere", "Detail", "Brand moment"],
    starter: "An atmospheric video of [place or scene] that captures [feeling] for our brand.",
    directive:
      "Shot plan: slow, atmospheric footage — wide establishing view, then rich close details (light, texture, movement), ending on a subtle brand moment such as the product or logo colour in frame. Evoke a feeling rather than explain. Captions carry the message the visuals suggest in one or two poetic but clear lines.",
    goal: "awareness",
    controls: { durationSec: 8 },
    thumb: "story",
  },
  {
    id: "video-in-use",
    types: ["video"],
    label: "Product in action",
    tagline: "Show it working in real life",
    beats: ["Everyday moment", "Using it", "The result"],
    starter: "Show [product] being used by [customer type] to [task or benefit].",
    directive:
      "Shot plan: a relatable everyday setting, a person naturally using the product with clear hand and product close-ups, then the satisfying result or reaction. Natural lighting and believable motion. Captions describe the benefit the viewer just saw and give a simple next step.",
    goal: "leads",
    controls: { durationSec: 8 },
    thumb: "play",
  },
  {
    id: "video-offer-teaser",
    types: ["video"],
    label: "Sale teaser",
    tagline: "Eye-catching promo for a deal",
    beats: ["Grab attention", "Show product", "Offer ends"],
    starter: "An eye-catching promo video for [offer] on [product], ending [deadline].",
    directive:
      "Shot plan: an energetic opening with bold colour and quick motion, the product shown clearly in two or three dynamic angles, finishing on a clean frame that leaves room for offer text added later. Upbeat pacing. Captions state the offer, the real deadline and one action.",
    goal: "offer",
    controls: { durationSec: 6 },
    thumb: "countdown",
  },
  {
    id: "video-place-tour",
    types: ["video"],
    label: "Place tour",
    tagline: "Welcome people into your space",
    beats: ["Arrive", "Look around", "Best spot"],
    starter: "A welcoming walk-through of [shop, studio or venue] showing [what makes it special].",
    directive:
      "Shot plan: a smooth walk-in from the entrance, a gentle glide through the space showing its character and people (if appropriate), and a final lingering shot on the best spot or signature detail. Warm, inviting light. Captions invite people to visit and include opening details only if provided.",
    goal: "awareness",
    controls: { durationSec: 8 },
    thumb: "story",
  },
  {
    id: "video-unboxing",
    types: ["video"],
    label: "Unboxing",
    tagline: "The fun of opening the package",
    beats: ["The box", "Opening", "First look"],
    starter: "An unboxing video of [product] showing [packaging detail] and [what's inside].",
    directive:
      "Shot plan: the closed package on a clean surface, hands opening it with satisfying close-up detail, then items revealed one by one and a final overhead shot of everything laid out. Crisp lighting, steady camera. Captions build anticipation and name what's inside only as provided.",
    goal: "launch",
    controls: { durationSec: 8 },
    thumb: "grid",
  },

  /* ───────────── Video script ───────────── */
  {
    id: "script-hook-value-cta",
    types: ["script"],
    label: "Quick tip video",
    tagline: "Grab attention, teach one thing, finish strong",
    beats: ["Opening line", "The tip", "Proof", "Next step"],
    starter:
      "A short video that teaches [audience] [one useful thing] and ends with [call to action].",
    directive:
      "Opening line (0–2s): a pattern-breaking statement or question that names the viewer's problem — no 'Hey guys' or introductions. The tip (2–3 short scenes): one clear, specific piece of value with on-screen text for each point. Proof: a quick demonstration or result. Final line: one call to action. Include what to say, what's shown and the on-screen text for every scene, with rough timings.",
    goal: "education",
    thumb: "play",
  },
  {
    id: "script-myth-reality",
    types: ["script"],
    label: "Myth vs truth",
    tagline: "Call out a myth and show the truth",
    beats: ["The myth", "The truth", "Show it", "Next step"],
    starter: "Bust the myth that [common belief] about [topic].",
    directive:
      "Open with the myth said out loud and shown as on-screen text with a quick 'wrong' visual cue. Cut to the truth in one sentence, then prove it with a short demonstration or example. Close with a call to action. Include spoken lines, visuals and on-screen text per scene with rough timings.",
    goal: "education",
    thumb: "compare",
  },
  {
    id: "script-pov",
    types: ["script"],
    label: "Relatable moment",
    tagline: "A funny, familiar situation people share",
    beats: ["Set the scene", "The moment", "The twist", "Next step"],
    starter: "A 'you know that moment when' video: [audience] when [relatable situation].",
    directive:
      "Start with on-screen text setting the relatable situation from the viewer's point of view. Build a quick, familiar moment with a light escalation, then a twist or payoff where the brand appears naturally (not as a hard sell). End with a light call to action. Keep dialogue minimal and expressions-driven; include visuals, on-screen text and any spoken lines per scene.",
    goal: "engagement",
    thumb: "story",
  },
  {
    id: "script-tutorial",
    types: ["script"],
    label: "30-second how-to",
    tagline: "Show the result, then three quick steps",
    beats: ["The result", "Step 1", "Step 2", "Step 3", "Next step"],
    starter: "A 30-second tutorial showing [audience] how to [task].",
    directive:
      "Scene 1: show the finished result first with on-screen text 'How to [task] in 30 seconds'. Scenes 2–4: one fast step each with a short spoken line and on-screen text that starts with a verb. Final scene: a call to follow or save for more. Include timings that add up to about 30 seconds.",
    goal: "education",
    controls: { durationSec: 30 },
    thumb: "list",
  },
  {
    id: "script-talking-head",
    types: ["script"],
    label: "Talk to camera",
    tagline: "You explain something, face to camera",
    beats: ["Opening line", "Main point", "Example", "Next step"],
    starter: "A talk-to-camera video where [speaker] explains [topic] to [audience].",
    directive:
      "Write natural spoken lines for one person talking directly to camera, in short sentences that are easy to say. Opening line hooks in under two seconds. One main point, backed by a concrete example or story. Suggest simple cutaways or on-screen text to keep it visually moving. End with one call to action. Include rough timings.",
    goal: "awareness",
    thumb: "chat",
  },
  {
    id: "script-customer-reaction",
    types: ["script"],
    label: "Customer reaction",
    tagline: "A real first reaction to your product",
    beats: ["Before", "First try", "Reaction", "Next step"],
    starter: "A video of [customer type] trying [product] for the first time and reacting.",
    directive:
      "Scene plan: the customer's quick expectation or doubt, their first moment trying the product (close-ups), an honest reaction, and a closing line with a call to action. Spoken lines should sound unscripted and natural; do not put invented praise in a real person's mouth — write suggested prompts or placeholders instead. Include visuals and on-screen text per scene.",
    goal: "leads",
    thumb: "question",
  },
  {
    id: "script-countdown",
    types: ["script"],
    label: "Top 3 list",
    tagline: "A quick countdown people watch to the end",
    beats: ["Opening", "Number 3", "Number 2", "Number 1", "Next step"],
    starter: "The top 3 [things, tips or products] for [audience] who want [outcome].",
    directive:
      "Open with a promise that the best one is saved for last. Count down from 3 to 1, one scene each with a big number on screen, a short spoken line and a clear visual. Number 1 should be the most surprising or valuable. End with a call to action. Keep the pace fast; include rough timings.",
    goal: "engagement",
    thumb: "countdown",
  },
  {
    id: "script-day-in-life",
    types: ["script"],
    label: "Day in the life",
    tagline: "A quick peek into a real day",
    beats: ["Morning", "Work", "Highlight", "Wrap-up"],
    starter: "A day-in-the-life video of [person or team] at [business], showing [highlight].",
    directive:
      "Fast montage structure with 4–6 short clips across the day, each with brief on-screen text (time of day plus what's happening). Include one highlight moment that shows what makes the business special, and a warm wrap-up line with a call to follow. Light voice-over lines optional; include visuals per clip.",
    goal: "awareness",
    thumb: "steps",
  },

  /* ───────────── Blog article ───────────── */
  {
    id: "article-how-to",
    types: ["article"],
    label: "How-to guide",
    tagline: "A practical guide from start to finish",
    beats: ["The problem", "Steps", "Common mistakes", "Summary"],
    starter: "A practical guide to [task] for [audience], from first step to finished.",
    directive:
      "Intro (2–3 short paragraphs): describe the reader's problem and promise what they'll be able to do by the end. Body: numbered H2 steps in the real order, each with specific instructions, an example and a tip. Add an H2 'Common mistakes' section with 3–5 items. Finish with a short summary and a next step. Use short paragraphs, bullet lists where helpful, and plain language.",
    goal: "education",
    controls: { length: "standard" },
    thumb: "steps",
  },
  {
    id: "article-listicle",
    types: ["article"],
    label: "Numbered list",
    tagline: "Easy to skim, full of useful points",
    beats: ["Intro", "List items", "Wrap-up"],
    starter: "[Number] things every [audience] should know about [topic].",
    directive:
      "Short intro that says who this is for and what they'll gain. One numbered H2 per item, each with a clear takeaway in the first sentence, a short explanation and a concrete example. Order by usefulness, not randomly. Brief wrap-up with a call to action. Skimmable: bold key phrases sparingly.",
    goal: "awareness",
    controls: { length: "standard" },
    thumb: "list",
  },
  {
    id: "article-comparison",
    types: ["article"],
    label: "Comparison",
    tagline: "Help readers choose between options",
    beats: ["The options", "What matters", "Side by side", "Our pick"],
    starter: "Compare [option A] and [option B] for [audience] deciding on [decision].",
    directive:
      "Introduce both options neutrally. Set out 3–5 decision criteria readers actually care about (cost, ease, results, fit). Compare the options under each criterion with an H2 and include a summary comparison table. End with a clear recommendation by type of reader ('Choose A if…, choose B if…'). Be fair and specific; avoid unverifiable claims.",
    goal: "education",
    controls: { length: "long" },
    thumb: "compare",
  },
  {
    id: "article-thought-leadership",
    types: ["article"],
    label: "Expert opinion",
    tagline: "Share your point of view on a trend",
    beats: ["Our view", "Why", "What it means", "What to do"],
    starter:
      "Argue that [point of view] about [industry trend], and what [audience] should do about it.",
    directive:
      "Open with a clear, distinctive point of view in the first paragraph. Support it with reasoning, real experience and evidence provided. Address the most common counter-argument fairly. Explain what it means for the reader, then give 3 practical things they should do. Confident, thoughtful, and free of buzzwords.",
    goal: "awareness",
    controls: { length: "standard" },
    thumb: "quote",
  },
  {
    id: "article-beginners-guide",
    types: ["article"],
    label: "Beginner's guide",
    tagline: "Explain a topic to someone brand new",
    beats: ["What it is", "Why it matters", "How to start", "Next steps"],
    starter: "A beginner's guide to [topic] for [audience] who are just getting started.",
    directive:
      "Assume zero prior knowledge. Define the topic in one simple sentence, then explain why it matters with an everyday example. Explain key terms in plain words the first time they appear. Give a simple 'how to get started' section with 3–5 steps and a short FAQ with 3 questions. Encouraging, patient tone.",
    goal: "education",
    controls: { length: "long" },
    thumb: "steps",
  },
  {
    id: "article-case-study",
    types: ["article"],
    label: "Case study",
    tagline: "A detailed customer success story",
    beats: ["The customer", "The challenge", "What we did", "The results"],
    starter:
      "A case study of how [customer] solved [challenge] with [our product or service] and achieved [result].",
    directive:
      "Sections as H2s: The customer (who they are), The challenge (specific and relatable), What we did (the approach in clear steps), The results (only figures and quotes provided), and Key takeaways for readers in a similar situation. Add a short summary box at the top with challenge, solution and result in one line each.",
    goal: "leads",
    controls: { length: "standard" },
    thumb: "split",
  },
  {
    id: "article-faq",
    types: ["article"],
    label: "FAQ page",
    tagline: "Answer the questions people search for",
    beats: ["Intro", "Questions & answers", "Still have questions?"],
    starter: "Answer the most common questions [audience] ask about [topic or product].",
    directive:
      "Short intro. Then 8–12 questions as H2 or H3 headings phrased exactly how people search or ask them, each answered directly in the first sentence (so it can appear in search and AI answers), followed by 1–3 sentences of detail. Group related questions. Close with how to get more help.",
    goal: "education",
    controls: { length: "standard" },
    thumb: "chat",
  },
  {
    id: "article-news-update",
    types: ["article"],
    label: "News & updates",
    tagline: "Share company news the right way",
    beats: ["What's new", "Why it matters", "Details", "What's next"],
    starter: "Share our news: [announcement], and what it means for [audience].",
    directive:
      "Headline and first paragraph state the news clearly (who, what, when). Explain why it matters to customers before any company background. Give the practical details (availability, pricing, how to access) as provided, include a quote only if one is given, and end with what's next and where to learn more.",
    goal: "launch",
    controls: { length: "short" },
    thumb: "hero",
  },
];

/** A cross-format shortlist for the start screen. */
export const POPULAR_TEMPLATE_IDS = [
  "carousel-myth-fact",
  "social-behind-scenes",
  "image-product-hero",
  "script-hook-value-cta",
  "ad-problem-solution",
  "article-how-to",
];

export function templatesFor(type: StudioType): StudioTemplate[] {
  return STUDIO_TEMPLATES.filter((t) => t.types.includes(type));
}

export function getTemplate(id: string | null | undefined): StudioTemplate | null {
  return id ? (STUDIO_TEMPLATES.find((t) => t.id === id) ?? null) : null;
}

export function templateFits(id: string | null | undefined, type: StudioType): boolean {
  return !!getTemplate(id)?.types.includes(type);
}

/** The prompt section for a template, or null when there isn't one. */
export function templateDirective(id: string | null | undefined): string | null {
  const t = getTemplate(id);
  if (!t) return null;
  return `${t.label}. ${t.directive} ${HONESTY}\nFollow this structure in order: ${t.beats.join(" → ")}.`;
}

const BLANK = /\[[^\]\n]{1,60}\]/g;

/** Start and end of the first [blank], for selecting it in the description. */
export function firstBlank(text: string): [number, number] | null {
  BLANK.lastIndex = 0;
  const m = BLANK.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

export function countBlanks(text: string): number {
  return text.match(BLANK)?.length ?? 0;
}

export function isTemplateStarter(text: string): boolean {
  const t = text.trim();
  return STUDIO_TEMPLATES.some((x) => x.starter === t);
}
