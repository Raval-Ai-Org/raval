// Gold examples, one per format: a finished video prompt written the way the
// best viral Reels are directed. Pure. The script writer reads the chosen
// format's example as a style reference (rhythm, cuts, how little is said,
// where the twist lands); it never copies the words. `{product}`, `{A}` and
// `{B}` stand for the product and the people.
//
// `subway-interview` is the reference this library was built from, kept word
// for word.

export const FORMAT_EXAMPLES: Record<string, string> = {
  "subway-interview": `Real vertical 9:16 smartphone video, a viral street interview show filmed inside a moving New York subway car, raw social-media footage, not cinematic. Handheld phone held by a third person standing in front of the bench, constant small vibration from the operating train. Harsh overhead fluorescent light, slightly desaturated gritty grade, deep focus, real skin texture. Light-blue molded plastic subway seats, scratched dark windows with the tunnel flashing past, grey metal wall panels with a small red sticker and an intercom button.

Two people sit side by side on the bench, turned slightly toward each other. Each holds a yellow subway card vertically up to their mouth like a microphone.

THE HOST (right side of the bench): late 20s, curly dark hair, black rectangular sunglasses, a small silver hoop earring, thin silver chain, dark navy blazer over a blue-and-white striped open-collar shirt. Animated, smiling, nods a lot, leans back.

THE GUEST (left side of the bench): late 20s woman, dark hair in a messy claw clip, a few loose strands, small gold hoops, oversized faded grey crewneck sweatshirt. Completely deadpan, dry, talks with sharp little gestures of her free hand.

The video is edited with fast hard cuts between them, about every 1.5 to 2 seconds, no dead air:

0-1.5s: SPLIT SCREEN, a thin vertical line down the middle, the guest on the left half and the host on the right half, both in medium close-up. Host into his card: "So what's your take?"

1.5-5.5s: HARD CUT to a medium close up of the guest, camera slightly below eye level. She stares at him, totally flat, and makes a little churning motion with her free hand: "In five years, filming real people for ads is gonna be like churning your own butter. Cute... nobody's paying for it."

5.5-7s: HARD CUT to a medium close-up of the host. He grins and shakes his head: "Hundred percent disagree."

7-9s: HARD CUT to the guest, deadpan, eyebrows up, she points her card at him: "Bro. You're AI."

9-12s: HARD CUT to the host. His grin freezes. He slowly touches his own cheek with two fingers, then looks down at his hand. "...wait.". The guest's laugh is heard off-screen.

Sound: loud continuous subway rumble and rattle, metal clanks and squeaks, both voices very close and crisp like clip-on lav mics, no music.`,

  "sidewalk-quiz": `Real vertical 9:16 smartphone video, a viral man-on-the-street quiz on a busy city sidewalk, raw social-media footage, not cinematic. Handheld phone held by the camera person, small walking bob, passers-by blurred behind. Overcast daylight, neutral grade, real skin texture, a shopfront with a striped awning and a bike rack. THE HOST {A}, holding a small black clip-on mic with a fluffy windscreen, eager. THE STRANGER {B}, carrying a tote bag, suspicious and funny.
0-1.5s: CLOSE on the host pushing the mic forward: "Guess how much this costs."
1.5-4s: HARD CUT to the stranger squinting at {product} in the host's hand: "...four dollars?"
4-6s: HARD CUT to the host, mock-shocked: "Four dollars. Wow."
6-9s: HARD CUT, the stranger grabs it, turns it over, genuinely impressed: "Wait, no, this is actually nice."
9-11s: HARD CUT, the stranger walks off still holding it, the host chasing: "That's mine—"
Sound: traffic, a distant siren, footsteps, close lav voices, no music.`,

  "podcast-clip": `Real vertical 9:16 video, a clipped moment from a small two-person podcast, filmed with a phone on a mini tripod plus a second phone angle, slightly soft edges. Warm practical lamp, acoustic foam panels, two broadcast mics on boom arms, mugs on the table, a neon sign glowing out of focus. {A} with headphones around the neck, leaning in. {B} reclined, sceptical.
0-2s: TIGHT on {A} into the mic: "Okay, I've never said this on the show."
2-4.5s: HARD CUT, {B} laughs: "No. Prove it."
4.5-8s: WIDE two-shot, {A} slides {product} across the table: "Three weeks. That's all it took."
8-11s: HARD CUT to {B}, quiet, turning it over: "...okay, that's annoying."
Sound: room tone, a faint chair creak, crisp mic voices, no music.`,

  "news-desk": `Real vertical 9:16 phone video of a deadpan home-made "local news" bit, phone propped on a stack of books. Desk-lamp key light, a bedsheet backdrop with a printed world map taped up, a hairbrush used as a microphone. {A} in a blazer over pyjama bottoms (shown only at the end).
0-1.5s: MEDIUM, dead serious: "Breaking news. Another sock has gone missing."
1.5-5s: HARD CUT to a "field report", {A} again in a beanie by the washing machine, whispering: "Witnesses say it just... left."
5-8s: HARD CUT back to the desk, {product} placed down like evidence: "Tonight, the case is closed."
8-10s: WIDE: {A} stands, revealing pyjama bottoms, and walks out of frame.
Sound: room tone, the anchor humming their own news jingle, no music.`,

  "couch-debate": `Real vertical 9:16 phone video, two friends arguing a silly debate on a couch, phone propped on the coffee table. Afternoon window light, a slightly messy living room, a throw blanket, takeaway cups. {A} cross-legged, intense. {B} lying back, unbothered.
0-1.5s: SPLIT SCREEN, a thin line down the middle, both faces. {A}: "Settle this. Is it worth it or not?"
1.5-4s: HARD CUT to {A} making the case with both hands.
4-6.5s: HARD CUT to {B}, not moving: "It's a want, not a need."
6.5-9s: HARD CUT, {A} produces {product} like a trump card: "Explain this, then."
9-11s: HARD CUT to {B}, a long pause: "...I hate that you're right."
Sound: room tone, cushion rustle, close voices, no music.`,

  "ask-the-pro": `Real vertical 9:16 phone video, a quick "asking a professional the question everyone googles" clip, handheld by the interviewer. A real salon, practical vanity light. Only the interviewer's hand and mic are in frame. {B} the pro in work clothes, confident, a little blunt, working with their hands.
0-1.5s: CLOSE on {B}: "Washing it every day? No."
1.5-6s: HARD CUT, {B} explains in one breath while sectioning hair.
6-9s: HARD CUT, {B} picks up {product} from the counter: "This is what I actually use on myself."
9-10s: HARD CUT, {B} points at the lens: "Stop doing that."
Sound: workplace ambience, close voices, no music.`,

  "pov-skit": `Real vertical 9:16 phone video, a POV skit where the camera is the viewer. Handheld at chest height as if held by "you". A real kitchen, daylight. {A} talks straight to the lens like you're in the room.
0-1.5s: {A} squints at you: "pov: you're still doing it the hard way."
1.5-6s: {A} watches you, escalating with small gestures: "No. Stop. Why are you like this."
6-8s: {A} takes {product} out of a drawer and hands it toward the lens.
8-10s: HARD CUT, {A} with arms folded, satisfied: "You're welcome."
Sound: room tone, close voice, no music.`,

  "office-skit": `Real vertical 9:16 phone video, a deadpan office skit filmed by a coworker from behind a monitor. Flat fluorescent office light, open-plan desks, lanyards, a sad desk plant. {A} the over-eager coworker. {B} the tired one with headphones half on.
0-1.5s: {A} leaning over the desk divider: "Quick sync?"
1.5-4s: HARD CUT to {B}'s blank stare.
4-7s: HARD CUT, {A}: "Let's circle back and take this offline, but like, now."
7-9s: HARD CUT, {B} silently puts {product} on the desk and turns back to the screen.
9-11s: HARD CUT, {A}, quieter: "...can I borrow that."
Sound: keyboard clicks, air-con hum, a distant phone ringing, no music.`,

  "roommate-skit": `Real vertical 9:16 phone video, a roommate skit in a small shared kitchen, phone propped on top of the microwave. An overhead warm bulb, mismatched mugs, a fridge covered in magnets. {A} the chaotic roommate. {B} the organised one.
0-1.5s: {B} holding up the evidence: "Who did this."
1.5-4s: HARD CUT, {A} frozen mid-bite.
4-7s: HARD CUT, quick back-and-forth: "Not me." "It's literally you."
7-10s: HARD CUT, {A} reveals {product}: "I already fixed it, actually."
10-12s: HARD CUT, {B}, suspicious and impressed: "...since when are you an adult?"
Sound: fridge hum, cutlery, close voices, no music.`,

  "call-skit": `Real vertical 9:16 phone video, a split-screen phone call skit, top and bottom halves, each person filming themselves. Top: {A} pacing in a hallway. Bottom: {B} lying on a bed.
0-1.5s: {A}, urgent: "Are you sitting down?"
1.5-5s: {B}: "You're pregnant. You're moving. You got fired."
5-8s: {A} holds {product} up to their own camera: "I found it. The one."
8-10s: {B} silently hangs up.
10-11s: Full frame, {A} alone: "...hello?"
Sound: the far voice with a slight phone-speaker colour, room tone, no music.`,

  "expectation-reality": `Real vertical 9:16 phone video, an expectation versus reality skit. Natural light, a real home.
0-1.5s: SPLIT SCREEN: left, {A} gracefully starting the morning; right, {A} fighting the alarm.
1.5-6s: HARD CUTS between the two, each beat more ridiculous on the reality side.
6-10s: HARD CUT, the reality side gets {product}, and now reality looks better than the expectation.
Sound: room tone, one short line per side, no music.`,

  "two-roles": `Real vertical 9:16 phone video, the creator plays both characters, switching with one prop (a cap), phone propped at eye level. The same room, the same light. {A}.
0-1.5s: Role one, no cap: "I deserve a treat."
1.5-3.5s: HARD CUT, role two, cap on, disgusted: "You deserve rent."
Alternating every 1.5 to 2 seconds as the argument grows.
8-10s: Role two takes {product} from role one's side of the frame.
10-12s: HARD CUT, role one alone: "...okay, that was a good choice."
Sound: close voice, room tone, no music.`,

  "infomercial-parody": `Real vertical 9:16 phone video, a self-aware parody of an old infomercial, phone on a small tripod in a real kitchen. An over-bright lamp aimed at the creator. {A} with exaggerated host energy.
0-1.5s: {A} fails at the everyday problem, slapstick: "Has this ever happened to you?"
1.5-5s: HARD CUT, the failure gets worse.
5-8s: HARD CUT, {A} straight-faced holding {product}, the energy suddenly real: "Okay, honestly? This just works."
8-10s: HARD CUT, back to the overacting, finger guns.
Sound: room tone, the creator's own "dun dun", no music.`,

  "car-confessional": `Real vertical 9:16 selfie video in a parked car, phone in a dashboard mount, seatbelt on, sunglasses pushed up. Daylight through the windscreen, slightly blown-out windows, natural skin. {A}.
0-1.5s: Leaning toward the phone: "Okay, I have to tell someone this."
1.5-8s: One continuous story, small pauses, a glance out of the window.
8-11s: Lifts {product} from the passenger seat into frame: "And this is why I'm not embarrassed anymore."
11-12s: Starts the car: "Anyway."
Sound: muffled traffic, an indicator ticking, close voice, no music.`,

  storytime: `Real vertical 9:16 selfie video, sitting on the bedroom floor against the bed, phone propped on a shelf at a slightly low angle. Fairy lights, a laundry pile half in frame. {A}.
0-1.5s: "So this is the most embarrassing thing that's happened to me."
1.5-9s: The story with two or three jump cuts, the same framing, the head position changing.
9-12s: The turn: {product} is how it got fixed.
12-14s: "Anyway. Never again."
Sound: room tone, close voice, no music.`,

  "hot-take": `Real vertical 9:16 selfie video walking down a residential street, phone held at arm's length, a natural walking bob. Golden-hour backlight, hedges, parked cars. {A}.
0-1.5s: Stops and turns to the lens: "Unpopular opinion: you're overpaying for this."
1.5-8s: Walking again, arguing the case.
8-10s: Holds up {product} from a jacket pocket as the proof.
10-11s: "Fight me."
Sound: footsteps, birds, a little wind on the mic, no music.`,

  "walk-and-talk": `Real vertical 9:16 vlog, selfie walking through a market, then into a shop. Mixed daylight and indoor light. {A}.
0-1.5s: "Come with me to get my weekly fix."
Cuts between selfie and the creator's own point-of-view shots of the stalls.
7-10s: Picks up {product} and turns it to the camera: "Third time this month. Don't."
10-12s: Walking out: "Worth it."
Sound: crowd ambience, close voice, no music.`,

  "founder-story": `Real vertical 9:16 phone video of a founder in their real workspace, a garage workbench, phone propped on a box. One work lamp, real mess. {A}.
0-1.5s: "In March, we had eleven dollars in the bank."
1.5-8s: Three jump cuts, the honest story in plain words.
8-11s: Picks up {product}: "Then one customer emailed us."
11-12s: A small smile: "So. Here we are."
Sound: room tone, a fan, close voice, no music.`,

  "reply-comment": `Real vertical 9:16 selfie video answering a sceptical comment, phone propped on the kitchen counter. Daylight. {A}.
0-1.5s: Reads the comment aloud, one eyebrow up: "'No way that actually works.'"
1.5-7s: Shows {product} up close, answering honestly.
7-10s: Does the proof live, in one take.
10-11s: "So... yeah."
Sound: room tone, close voice, no music.`,

  "honest-review": `Real vertical 9:16 selfie video, a sceptical first try at a desk by a window. {A}, unimpressed at first.
0-1.5s: "I didn't want to like this."
1.5-6s: First use, one honest small complaint: "The lid is annoying. I'll say that."
6-9s: HARD CUT, days later, a different top: "But I haven't stopped using it."
9-11s: Holds it up: "Eight out of ten, and I don't give out tens."
Sound: room tone, close voice, no music.`,

  unboxing: `Real vertical 9:16 phone video, handheld almost overhead on the hands opening a parcel on a bed, then a cut to the face. {A}.
0-1.5s: Tearing the tape, mid-reaction: "It's here."
1.5-6s: Unwrapping, real fumbling, the packaging details close-up.
6-9s: CUT to {A}'s face holding {product}: "Oh, it's heavier than I thought."
9-10s: Tries it once.
Sound: tape, cardboard, paper crinkle, close voice, no music.`,

  "try-test": `Real vertical 9:16 phone video, two friends do a blind test at a kitchen table, phone propped low. {A} hosts, {B} blindfolded with a scarf.
0-1.5s: {A}: "If you can tell which one is ours, I'll pay for dinner."
1.5-7s: HARD CUTS of {B}'s reactions to option one and option two.
7-9s: {B} picks.
9-11s: HARD CUT, the reveal, a genuine reaction: "No. Shut up."
Sound: cutlery, close voices, no music.`,

  "asmr-hands": `Real vertical 9:16 macro-ish phone video, only hands, on a wooden table, soft window light, deep but natural focus.
0-1.5s: The most satisfying first sound from {product}: a click.
1.5-10s: Four or five tactile moments with {product}, each one sound.
10-12s: It is placed down in its home.
Sound: crisp close sounds only, no voice, no music.`,

  "before-after": `Real vertical 9:16 selfie video.
0-1.5s: The before, real and a little unflattering: "This was me last week."
1.5-3s: A hand covers the lens.
3-7s: The after, the same framing and light, {product} visible.
7-9s: A slow turn showing the result.
Sound: a finger snap, room tone, no music.`,

  "three-reasons": `Real vertical 9:16 selfie video, counting on fingers, in three quick places around the home. {A}.
0-1.5s: Three fingers up: "Three reasons I'm never going back."
1.5-4.5s: HARD CUT, one finger, reason one, shown not told.
4.5-7.5s: HARD CUT, two fingers, reason two.
7.5-10.5s: HARD CUT, three fingers, reason three, the funniest.
10.5-12s: {product} in hand: "Number three is personal."
Sound: room tone, close voice, no music.`,

  grwm: `Real vertical 9:16 selfie video, get ready with me, phone propped against the bathroom mirror. Window daylight, not a ring light. {A}.
0-1.5s: Mid-routine, already talking: "Get ready with me while I tell you about the worst date ever."
1.5-10s: Steps of the routine, the story told in pieces, {product} used as one natural step.
10-12s: The finished look, the story's payoff: "...and that's why I'm going alone tonight."
Sound: room tone, a tap running, close voice, no music.`,

  "day-in-life": `Real vertical 9:16 phone video, a realistic day-in-my-life montage of 1 to 1.5 second clips: the alarm, coffee, the commute, a desk, an errand, the evening. A mix of selfie and point-of-view shots, natural light changing through the day. {product} appears in one beat, naturally. A quiet diary voiceover: "Woke up late. Again." / "Coffee first, always." / "Small wins." Ends on a cosy evening shot.
Sound: the close voiceover, each clip's own ambient sound, no music.`,

  "mirror-routine": `Real vertical 9:16 mirror-selfie video in a bathroom, the phone visible in the reflection with a plain case and no logo. {A}.
0-1.5s: "The routine that fixed my skin."
1.5-9s: The steps in quick jump cuts, {product} one of them.
9-11s: The result, a satisfied look in the mirror.
Sound: room ambience, close voice, no music.`,

  "cook-with-me": `Real vertical 9:16 phone video in a real home kitchen, phone propped by the hob plus overhead shots of the hands. Warm under-cabinet light, steam. {A}.
0-1.5s: Something sizzling: "Dinner in ten minutes, no excuses."
1.5-9s: Quick hard cuts of the steps, {product} used where it really fits.
9-12s: The first bite, a real reaction: "Okay. Okay."
Sound: sizzle, chopping, close voice, no music.`,

  "pack-order": `Real vertical 9:16 phone video at a small business packing table: a tape gun, tissue paper, a label printer, shelves of stock behind.
0-1.5s: Hands grab {product} off the shelf: "Pack an order with me for Sarah."
1.5-8s: Wrapping, a handwritten thank-you note, real fumbles.
8-10s: CUT to the face: "This is her fourth order. She's basically family."
10-11s: The box sealed.
Sound: tape screech, paper rustle, close voice, no music.`,
};

export function formatExample(id: string): string {
  return FORMAT_EXAMPLES[id] ?? "";
}
