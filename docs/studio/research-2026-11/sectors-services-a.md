# Sector research: digital, creative and professional services (group A)

Research round 2026-11. This round covers the sectors where Studio's pictures are weakest:
services with no physical product. Each entry below answers one question. **When there is
nothing to hold, what does a picture that rings true show?** The answer is nearly always one
of four things the business already has:

1. **the work itself**: a shipped screen, a finished edit, a real deliverable, a real room;
2. **the people doing it**: named, consenting team members at their real desks, sets or offices;
3. **a dated fact the business gives**: a deadline, a release date, an opening time, a price;
4. **proof the business supplies**: its own case study, credential, guarantee, or a review it has permission to quote.

Symbolic stock scenes (rockets, cranes, handshakes, light bulbs, chess pieces, shields) say
none of these. They are the clichés each entry lists to avoid.

Rules for every entry: brand-neutral; no invented numbers, reviews, logos, awards, dashboards,
chats, search results or press; proof means something the business itself can supply. Sources
are in the table at the end.

---

## web-dev-agency

```json
{
  "id": "web-dev-agency",
  "label": "Web design and development agency",
  "kind": "service",
  "parent": "agency",
  "match": ["web design", "web development", "website design", "shopify", "wordpress", "webflow", "landing pages", "ecommerce websites", "ui/ux", "website agency"],
  "show": "A real client site the agency shipped, in a browser or phone frame: hero section, scroll-through, editor-to-live split, or the client's own dated speed or accessibility report.",
  "proof": ["Live client sites it built, with the client's permission", "Before/after of a redesign it did", "Dated speed/accessibility report of its own build", "Process screens: wireframe, design file, staging", "Verbatim client review it has permission to quote"],
  "wants": "A site that looks premium, loads fast, ranks, and brings enquiries or sales, delivered on time and easy to update later.",
  "doubts": "Missed deadlines, template work passed off as custom, hidden costs, vanishing after launch, a site they can't edit themselves.",
  "cliches": ["rocket launch", "glowing code rain", "laptop on a beach"],
  "angles": ["We rebuilt [client]'s site: here is before and after", "From Figma to live in one scroll", "What your homepage should answer in 5 seconds", "Inside a launch week: checklist we run on every site"],
  "carousels": ["Old homepage -> problem 1 -> problem 2 -> new homepage -> what changed -> book a call", "Brief -> wireframe -> design -> build -> live site -> client's words", "5 signs your site is costing you leads -> one fix per slide -> audit offer"],
  "videoArc": "Old site on screen -> hard cut to new site in a browser frame -> smooth scroll of real sections -> phone view -> designer at desk explaining one choice -> agency name and contact",
  "typeVoices": ["dev-mono", "swiss-grotesk", "expressive-grotesk"],
  "moments": ["New year planning", "Black Friday / Cyber Monday prep", "Q4 site refresh season", "Ramadan / Eid ecommerce prep", "Platform updates (Shopify, WordPress)", "Agency anniversary or 100th site"]
}
```

## software-it-services

```json
{
  "id": "software-it-services",
  "label": "Software development and IT services",
  "kind": "service",
  "parent": "b2b",
  "match": ["software development", "custom software", "it services", "managed it", "outsourcing", "offshore development", "devops", "cloud migration", "dedicated team", "it support", "staff augmentation"],
  "show": "The system it built: a real product screen or architecture diagram from its own case study, the actual team at work (stand-up, whiteboard), tech-stack badges, delivery timeline.",
  "proof": ["Published case study naming the client (with permission)", "Architecture or flow diagram from a real project", "Named engineers and their real roles", "Certifications and partner tiers it actually holds", "Verified third-party reviews it can link to"],
  "wants": "Senior engineers who understand the business, clear communication across time zones, predictable cost, secure and maintainable code.",
  "doubts": "Juniors billed as seniors, scope creep, poor English or overlap hours, IP and security risk, being locked in to a vendor.",
  "cliches": ["glowing circuit brain", "binary code rain", "faceless hoodie hacker"],
  "angles": ["How we moved [client type] to the cloud without downtime", "Meet the engineers who build your product", "Our stack for [industry] apps, and why", "What a first two weeks with our team looks like"],
  "carousels": ["Client problem -> constraint -> architecture -> sprints -> launch -> client's words", "Week 1 -> week 2 -> week 4 -> week 8 -> handover -> support", "Myth about outsourcing -> what really happens -> how we handle it -> contact"],
  "videoArc": "Engineer at a real desk names a problem -> screen recording of the shipped system -> diagram builds in 3 steps -> team stand-up shot -> logo with stack and service line",
  "typeVoices": ["geometric-tech", "dev-mono", "swiss-grotesk"],
  "moments": ["New fiscal year budgets", "Q4 planning", "Cloud/security events", "Major tech conference weeks", "Team milestones and hires", "Independence days for local tech hubs"]
}
```

## saas

```json
{
  "id": "saas",
  "label": "SaaS / software product",
  "kind": "digital",
  "parent": "saas",
  "match": ["saas", "platform", "software", "dashboard", "automation", "workflow", "integrations", "free trial", "subscription", "for teams", "api"],
  "show": "The real product UI cropped to one feature in a browser or device frame, a before/after of the workflow, a short screen recording, or a named customer with the outcome they gave.",
  "proof": ["Real product screenshots and screen recordings", "Named customer quote with their permission", "Integrations it really has", "Security/compliance certificates it holds", "Public changelog and release notes"],
  "wants": "Saves time or money on one painful job, easy to adopt, works with tools they already use, fair pricing, good support.",
  "doubts": "Hard to set up, team won't adopt it, data security, hidden pricing, the product being abandoned, migrating data out.",
  "cliches": ["floating 3D dashboard of fake numbers", "rocket ship growth", "people high-fiving a laptop"],
  "angles": ["Do [painful task] in one click instead of ten", "New: [feature] is live for every plan", "How [customer type] uses us for [job]", "Stop copying data between [tool] and [tool]"],
  "carousels": ["The old way -> what it costs -> the new way in our UI -> step 1 -> step 2 -> try it", "Feature launch: what it is -> screenshot -> who it's for -> how to turn it on", "Customer story: their team -> problem -> setup -> their words -> CTA"],
  "videoArc": "Text hook naming the pain -> cursor works through the real UI -> feature result on screen -> one line from a named customer or founder -> product name and trial CTA",
  "typeVoices": ["geometric-tech", "bold-geo", "swiss-grotesk"],
  "moments": ["Product launch / feature release", "New year planning", "Black Friday SaaS deals", "Fiscal year end", "Product Hunt launch day", "Major industry conference"]
}
```

## mobile-app

```json
{
  "id": "mobile-app",
  "label": "Mobile app",
  "kind": "digital",
  "parent": "saas",
  "match": ["mobile app", "ios", "android", "app store", "google play", "download the app", "available on", "app for", "in-app"],
  "show": "The real app screens in a phone held by a hand or on a clean background, one benefit per screen, a screen recording of a key flow, store badges.",
  "proof": ["Real app screens and screen recordings", "Store rating it really has, with the date", "Verbatim store reviews (quoted exactly)", "Feature updates from its own release notes", "Founder or team on camera"],
  "wants": "An app that solves one job quickly, feels smooth, is safe with their data and worth the subscription or space on the phone.",
  "doubts": "Paywall surprises, battery or data drain, privacy, ads, the app feeling unfinished, losing data or progress.",
  "cliches": ["phone exploding with icons", "fake 5-star rating cascade", "rocket from a phone screen"],
  "angles": ["[Do the job] in [real number of] taps", "What's new in version [x]", "Built for [audience] who [situation]", "Here's the one screen people use most"],
  "carousels": ["Hook screen -> benefit 1 screen -> benefit 2 screen -> benefit 3 screen -> download badges", "Update: what changed -> before -> after -> how to get it", "Problem -> how people solve it today -> how the app solves it -> download"],
  "videoArc": "First second: the app's most striking real screen moving -> thumb taps through the core flow -> result screen -> short real reaction or caption -> store badges",
  "typeVoices": ["bold-geo", "geometric-tech", "rounded-friendly"],
  "moments": ["New year resolutions", "Back to school", "Ramadan / Eid", "App update releases", "Holiday season", "Platform OS release weeks"],
  "regulated": "Store screenshots must show the real app in use; never draw a UI or a rating it doesn't have."
}
```

## game-studio

```json
{
  "id": "game-studio",
  "label": "Game studio / indie game",
  "kind": "digital",
  "parent": "saas",
  "match": ["game studio", "indie game", "steam", "wishlist", "gameplay", "game developer", "console", "early access", "playtest", "devlog"],
  "show": "Real gameplay frames or key art with the game's logo lockup, platform badges and release date; dev before/after clips; the team at their desks; capsule art cropped for social.",
  "proof": ["Real gameplay captures", "Official key art and logo lockup", "Confirmed release date and platforms", "Devlog before/after of its own builds", "Review quotes only with source and permission"],
  "wants": "A game that looks unique in one second, a clear genre and hook, a date to wishlist for, and a team that listens to players.",
  "doubts": "Is it real gameplay or a render? Will it ship? Is it finished, bug-free, worth the price, or another asset flip?",
  "cliches": ["generic glowing sword hero", "controller with lightning", "fake 'game of the year' laurels"],
  "angles": ["Wishlist now: out [date] on [platforms]", "One year of progress: then vs now", "This is what [mechanic] looks like in motion", "New update [name] is live"],
  "carousels": ["Key art -> core mechanic frame -> world frame -> boss/feature frame -> date and wishlist", "Devlog: old build -> new build -> what changed -> why -> playtest invite", "Meet the team: role -> their part of the game -> favourite moment -> wishlist"],
  "videoArc": "Frame 1: the most arresting real gameplay moment -> 2-3 hard cuts of mechanics with no menus -> one surprising beat -> logo lockup -> platforms and release date",
  "typeVoices": ["angular-gaming", "arcade-pixel", "arena-condensed"],
  "moments": ["Steam Next Fest", "Release day / Early Access launch", "Steam seasonal sales", "Major game showcase weeks", "Halloween / winter events", "Update and DLC drops"],
  "regulated": "Steam capsules: no review scores, awards, discount text or CTAs on base art; show real gameplay, not renders."
}
```

## esports-gaming

```json
{
  "id": "esports-gaming",
  "label": "Esports team, gaming cafe or tournament",
  "kind": "venue",
  "parent": "local",
  "match": ["esports", "gaming cafe", "gaming lounge", "lan", "tournament", "pc gaming", "ps5", "roster", "scrims", "gaming zone", "valorant", "pubg"],
  "show": "Real players and the real room: rig rows, a match on stream, roster cards with real players' photos, match-day card with opponent, time and stream link, bracket and prize pool it set.",
  "proof": ["Real roster with player photos and handles", "Match results it played, with date", "Its venue: rigs, specs, seats", "Real tournament brackets and prize it set", "Clips from its own streams"],
  "wants": "Good rigs and ping, a fair tournament, a crowd and community, clear times, prices and prizes, a team to cheer for.",
  "doubts": "Slow PCs, unfair brackets or unpaid prizes, a dead venue, unsafe or rowdy atmosphere, events that start late.",
  "cliches": ["neon gamer silhouette", "flaming controller", "fake trophy with sparks"],
  "angles": ["Match day: [team] vs [team], [time], live on [platform]", "Welcome to the roster: [player]", "[Game] tournament this [day]: prize [amount set]", "Tonight's setup: [real specs] ready to play"],
  "carousels": ["Event name -> date and format -> prize -> rules -> how to register", "Roster: player 1 -> player 2 -> player 3 -> player 4 -> coach -> match schedule", "Our rigs -> screens -> seats -> snacks -> prices -> book"],
  "videoArc": "Crowd or rig row lights up -> real clutch clip from its own stream -> players' reaction -> bracket or score card -> date, venue and register link",
  "typeVoices": ["arena-condensed", "angular-gaming", "condensed-punch"],
  "moments": ["Major game patch / season start", "Big tournament finals weeks", "School and university holidays", "Eid / Diwali / Christmas breaks", "New game launches", "Weekly league nights"]
}
```

## marketing-agency

```json
{
  "id": "marketing-agency",
  "label": "Marketing and social media agency",
  "kind": "service",
  "parent": "agency",
  "match": ["marketing agency", "digital marketing", "social media management", "performance marketing", "seo", "paid ads", "content creation", "growth", "meta ads", "branding and marketing"],
  "show": "Its real client work: actual posts and ads it made in phone frames, a campaign breakdown with its own reported numbers, the team in a real planning session, content-day shoot behind the scenes.",
  "proof": ["Real posts/ads it made for named clients (permission)", "Campaign results it reports from its own accounts", "Case study: brief, idea, execution, outcome", "Named team and their roles", "Verbatim client review it has permission to use"],
  "wants": "More enquiries or sales they can measure, creative that sounds like them, honest reporting, a team that is quick and proactive.",
  "doubts": "Vanity metrics, juniors on the account, long contracts, templated content, inflated or cherry-picked case studies.",
  "cliches": ["megaphone and rising arrows", "chess strategy", "fake analytics screen spike"],
  "angles": ["The campaign behind [client]'s [result they reported]", "One brief, three ideas: here's what we pitched", "What we post for a [industry] brand in a month", "Behind the scenes of a content day"],
  "carousels": ["Client challenge -> insight -> idea -> 3 real posts -> reported result -> work with us", "Bad hook -> why -> better hook -> real example from our work -> tip", "Monday -> Tuesday -> Wednesday -> Thursday -> Friday: a week inside the agency"],
  "videoArc": "Strategist names a client problem on camera -> real posts it made scroll in a phone -> shoot-day BTS clip -> result line the client approved -> agency name and contact",
  "typeVoices": ["expressive-grotesk", "swiss-grotesk", "bold-geo"],
  "moments": ["New year / Q1 planning", "Black Friday and holiday campaigns", "Ramadan campaign season", "Platform algorithm or feature changes", "Award or pitch wins it really had", "Agency anniversary"]
}
```

## design-branding-studio

```json
{
  "id": "design-branding-studio",
  "label": "Design and branding studio",
  "kind": "service",
  "parent": "agency",
  "match": ["branding", "brand identity", "logo design", "graphic design", "design studio", "packaging design", "visual identity", "creative studio", "rebrand"],
  "show": "Its real identity work: logo on the client's real signage or packaging, a before/after rebrand, sketch-to-final process, the brand system laid out (colours, type, applications).",
  "proof": ["Before/after of a rebrand it did (permission)", "Process: sketches, explorations, rationale", "Real applications: signage, packaging, site", "Client's own words on the result", "Published case study with the brief"],
  "wants": "An identity that feels like them and stands out, a clear reason behind each choice, files and guidelines they can use.",
  "doubts": "Paying for 'just a logo', unclear revisions, designs that look like a template or another brand, no rationale.",
  "cliches": ["lightbulb idea", "paint splash rainbow", "floating mockup of blank cards"],
  "angles": ["Before and after: [client]'s new identity", "Why this logo is shaped like that", "From sketch to sign: one mark's journey", "What a brand system includes (it's more than a logo)"],
  "carousels": ["Old logo -> problem -> sketches -> final mark -> colours and type -> on the shopfront", "The brief -> 3 directions -> the chosen one -> why -> applications", "Logo -> business card -> packaging -> signage -> social -> website"],
  "videoArc": "Old mark on screen -> pencil sketch -> vector build in the design tool -> mark on real packaging or signage -> studio name",
  "typeVoices": ["studio-pair", "expressive-grotesk", "editorial-serif"],
  "moments": ["New year rebrands", "Client launch days", "Design week events", "Studio anniversary", "Ramadan / Diwali packaging season", "Portfolio refresh"]
}
```

## video-photo-production

```json
{
  "id": "video-photo-production",
  "label": "Video and photo production",
  "kind": "service",
  "parent": "agency",
  "match": ["video production", "videography", "photography", "commercial shoots", "corporate video", "wedding films", "content production", "studio hire", "drone", "post-production"],
  "show": "Frames from its own finished work, the set behind the camera (lights, crew, monitor), a raw-vs-graded split, the showreel, its real studio.",
  "proof": ["Its own showreel and finished frames (permission)", "Behind-the-scenes from real shoots", "Raw vs graded / edited comparison", "Gear and studio it really owns", "Client's verbatim words with permission"],
  "wants": "Footage that looks cinematic and on-brand, a smooth shoot day, fast turnaround, a fixed price and usage rights made clear.",
  "doubts": "Footage that looks amateur, delays in the edit, unclear rights, budget overruns, missed key moments at an event.",
  "cliches": ["film reel and clapperboard icon", "lens flare everywhere", "generic camera on tripod"],
  "angles": ["From shoot day to final cut: [project]", "Raw vs graded: what colour does", "This frame took [real] hours of lighting", "What to prep before your brand shoot"],
  "carousels": ["Final frame -> lighting setup -> raw -> graded -> crew shot -> book a shoot", "Shot list -> on set -> edit timeline -> final", "Brand shoot checklist: location -> wardrobe -> props -> shot list -> schedule"],
  "videoArc": "Hook: striking frame from its finished film -> pull back to reveal the set and crew -> monitor view -> raw-to-graded wipe -> final clip -> studio name and contact",
  "typeVoices": ["studio-pair", "editorial-serif", "condensed-punch"],
  "moments": ["Wedding season", "Eid / Diwali / Christmas campaigns", "Product launch seasons", "Event and conference season", "Year-end recap reels", "Graduation season"]
}
```

## consulting-b2b

```json
{
  "id": "consulting-b2b",
  "label": "Consulting / B2B advisory",
  "kind": "service",
  "parent": "professional",
  "match": ["consulting", "consultancy", "advisory", "strategy", "management consulting", "operations", "transformation", "business advisory", "fractional", "b2b services"],
  "show": "The consultant as a real named person with their point of view, a framework they really use drawn as a clean diagram, a workshop in progress, a page from their published report.",
  "proof": ["Named consultants and their real experience", "Published insights, reports or talks", "Frameworks and methods it actually uses", "Client case with permission and its outcome", "Certifications and memberships it holds"],
  "wants": "Someone who understands their industry and gives a clear, practical plan that delivers a result worth the fee.",
  "doubts": "Slide decks with no action, generic advice, junior staff, costly retainers, no measurable change after the project.",
  "cliches": ["chess pieces strategy", "handshake in suits", "arrows on a whiteboard"],
  "angles": ["The question we ask every [industry] CEO first", "Three signs your [process] is costing you", "How we'd approach [common problem] in 90 days", "What we learned from [number] projects in [industry]"],
  "carousels": ["Common belief -> what we see -> the framework -> step 1 -> step 2 -> talk to us", "Problem -> diagnosis -> plan -> result the client reported", "Consultant portrait -> point of view -> 3 takeaways -> link to full report"],
  "videoArc": "Consultant on camera opens with a sharp opinion -> framework draws on screen -> workshop clip -> one takeaway in text -> name, firm and contact",
  "typeVoices": ["swiss-grotesk", "editorial-serif", "classic-trust"],
  "moments": ["New fiscal year planning", "Budget season", "Industry conference weeks", "Q4 strategy reviews", "Regulatory changes in the field", "Report or white paper launch"]
}
```

## recruitment-hr

```json
{
  "id": "recruitment-hr",
  "label": "Recruitment agency / HR services",
  "kind": "service",
  "parent": "professional",
  "match": ["recruitment", "staffing", "hiring", "headhunting", "talent acquisition", "hr services", "payroll", "jobs", "we're hiring", "placement", "manpower"],
  "show": "A clear job card (title, location, pay band and how to apply), the real recruiter as a named person, the team's office, a candidate or employee story with consent.",
  "proof": ["Live roles with real title, location, pay band", "Named recruiters and their specialisms", "Placements it made, shared with consent", "Licences or memberships it holds", "Verbatim candidate/client reviews with permission"],
  "wants": "Employers: good candidates fast. Candidates: real jobs, clear pay, quick replies and honest feedback.",
  "doubts": "Fake or stale job posts, ghosting, upfront fees for candidates, poor matches, data misuse.",
  "cliches": ["puzzle pieces fitting", "magnifier over people icons", "handshake across desk"],
  "angles": ["Now hiring: [role] in [city], [pay band]", "Meet [name], who recruits for [field]", "What hiring managers in [field] look for", "From application to offer: our [n]-step process"],
  "carousels": ["Role -> what you'll do -> what you need -> pay and benefits -> how to apply", "CV mistake -> why it hurts -> fix -> recruiter tip -> submit your CV", "Recruiter 1 -> recruiter 2 -> recruiter 3 -> specialisms -> contact"],
  "videoArc": "Recruiter on camera names the role and city -> office or workplace clip -> three requirements on screen -> pay band and apply link",
  "typeVoices": ["sturdy-grotesk", "swiss-grotesk", "humanist-care"],
  "moments": ["New year job hunt", "Graduate season", "Post-Eid / post-bonus job moves", "Peak seasonal hiring", "Labour day", "Fiscal year start"],
  "regulated": "Job ads on Meta are a special ad category: limited targeting. Never invent salaries or roles."
}
```

## law-firm

```json
{
  "id": "law-firm",
  "label": "Law firm / lawyer",
  "kind": "service",
  "parent": "professional",
  "match": ["law firm", "lawyer", "attorney", "advocate", "solicitor", "legal services", "litigation", "immigration law", "family law", "corporate law", "legal advice"],
  "show": "The real lawyer's portrait with name and practice area, a plain-language explainer card, a deadline or law-change card for a niche audience, the firm's real office.",
  "proof": ["Named lawyers, bar admission and practice areas", "Plain explainers of real laws and deadlines", "Published articles or talks by its lawyers", "Office address and consultation process", "Client testimonials only where rules allow"],
  "wants": "Someone competent who explains things plainly, tells them their options and cost, and answers when they call.",
  "doubts": "Huge fees, slow replies, being passed to a junior, unclear chances, lawyers who promise outcomes.",
  "cliches": ["gavel and scales", "lady justice statue", "handshake in suits"],
  "angles": ["[Law/rule] changes on [date]: what it means for [audience]", "Meet [name], [practice area] lawyer", "3 questions to ask before signing a [contract]", "Your rights if [situation]"],
  "carousels": ["Common question -> plain answer -> what to do -> what not to do -> consult", "Deadline -> who it affects -> what you need -> how we help", "Lawyer portrait -> practice area -> experience -> how to book"],
  "videoArc": "Lawyer at their desk states one plain-language rule -> key point on screen -> who it applies to -> lawyer's name, practice area and how to book",
  "typeVoices": ["classic-trust", "garamond-calm", "editorial-serif"],
  "moments": ["Law or rule changes", "Immigration programme deadlines", "Tax year end (corporate)", "New year (family and estate planning)", "Small business week", "Legal awareness days"],
  "regulated": "No promised outcomes or misleading results; testimonials often limited; India's BCI bars solicitation."
}
```

## accounting-tax

```json
{
  "id": "accounting-tax",
  "label": "Accounting, bookkeeping and tax",
  "kind": "service",
  "parent": "finance",
  "match": ["accounting", "accountant", "bookkeeping", "tax", "tax filing", "cpa", "chartered accountant", "vat", "payroll", "audit", "tax return"],
  "show": "A dated deadline card for the right audience, a checklist of documents, the named accountant at work, a clean explainer of one rule.",
  "proof": ["Named accountants and qualifications held", "Real deadlines from the tax authority", "Fixed-fee packages it offers", "Software it is certified in", "Verbatim client reviews where rules allow"],
  "wants": "Filing on time with no fines, fewer taxes legally, clear fees, and someone who answers questions in plain words.",
  "doubts": "Missed deadlines, penalties, surprise fees, being treated as small fry, data security, jargon.",
  "cliches": ["calculator and coins pile", "magnifying glass on graphs", "stack of papers and stress"],
  "angles": ["[Tax] deadline is [date]: here's your checklist", "Documents you need for your [year] return", "Freelancer? 3 things to set aside for tax", "What changed in this year's budget for [audience]"],
  "carousels": ["Deadline -> who must file -> documents -> common mistakes -> we file it for you", "Budget change -> who it affects -> what to do now -> book a call", "Bookkeeping myth -> fact -> example -> tip"],
  "videoArc": "Accountant at desk: 'If you're a [audience], [deadline] matters' -> checklist builds on screen -> one common mistake -> name, firm and booking link",
  "typeVoices": ["classic-trust", "swiss-grotesk", "geometric-tech"],
  "moments": ["Tax return deadlines", "Budget announcements", "Fiscal year end", "VAT / GST quarter dates", "Payroll year end", "New business registration season"],
  "regulated": "Professional bodies (e.g. ICAI in India) limit advertising; inform, don't solicit or promise savings."
}
```

## insurance

```json
{
  "id": "insurance",
  "label": "Insurance agency / broker",
  "kind": "service",
  "parent": "finance",
  "match": ["insurance", "insurance broker", "insurance agent", "life insurance", "health insurance", "car insurance", "takaful", "coverage", "policy", "premium", "claims"],
  "show": "The named agent or broker, a plain card explaining one cover type and what it really includes, a claims-process steps card, the local office.",
  "proof": ["Named licensed agents and their licence", "Insurers it really represents", "Claims process it follows, step by step", "Plain cover explainers from real policies", "Client stories with consent, where rules allow"],
  "wants": "The right cover at a fair price, plain explanations, and someone who helps when a claim happens.",
  "doubts": "Fine print, claims refused, pushy selling, premiums rising, not knowing what is actually covered.",
  "cliches": ["umbrella in the rain", "family under a shield", "crashed car with people smiling"],
  "angles": ["What your [type] policy actually covers", "How to make a claim: [n] steps", "Meet [name], your local agent", "Before you renew: 3 questions to ask"],
  "carousels": ["Cover type -> what's included -> what's not -> who needs it -> get a quote", "Claim happened -> step 1 -> step 2 -> step 3 -> we help", "Myth -> fact -> example -> talk to us"],
  "videoArc": "Agent on camera asks one question people miss -> policy point on screen -> claims steps -> agent's name, licence line and contact",
  "typeVoices": ["classic-trust", "humanist-care", "geometric-tech"],
  "moments": ["Policy renewal seasons", "Monsoon / storm season", "New car buying season", "Hajj and travel season", "Open enrolment periods", "New year planning"],
  "regulated": "Insurance ads are regulated by state/national rules: no misleading cover or price claims; show the licence."
}
```

## financial-advisor

```json
{
  "id": "financial-advisor",
  "label": "Financial advisor / wealth planner",
  "kind": "service",
  "parent": "finance",
  "match": ["financial advisor", "financial planner", "wealth management", "retirement planning", "investment advice", "financial planning", "estate planning", "fiduciary", "portfolio"],
  "show": "The real advisor as a named person, a plain-language explainer of one concept, a planning-meeting setting, a dated market note in their own words.",
  "proof": ["Named advisors, registrations and credentials", "Their published notes and explainers", "Fee structure stated plainly", "Process: first meeting to plan", "Testimonials only where the rules allow"],
  "wants": "A trusted person who explains plainly, plans for their goals, is transparent on fees and acts in their interest.",
  "doubts": "Hidden fees, being sold products, conflicts of interest, risky bets, jargon, chasing returns.",
  "cliches": ["piggy bank and coins", "upward arrow on gold bars", "couple on beach retirement"],
  "angles": ["What [concept] means for your retirement", "Before you [life event], ask these questions", "Meet [name]: how we build a plan", "How our fees work, in plain words"],
  "carousels": ["Question -> plain answer -> example (no promises) -> what to do -> book a meeting", "Life event -> money decisions -> what to plan -> next step", "First meeting -> discovery -> plan -> review -> ongoing"],
  "videoArc": "Advisor on camera names one common money mistake -> plain explainer on screen -> risk line -> name, credentials, contact and required disclosure",
  "typeVoices": ["classic-trust", "garamond-calm", "geometric-tech"],
  "moments": ["Tax year end", "Budget announcements", "Retirement savings deadlines", "New year planning", "Market-moving events", "Bonus season"],
  "regulated": "Financial promotions must be fair, clear, not misleading; no promised returns; testimonials limited (SEC/FCA)."
}
```

## fintech-banking

```json
{
  "id": "fintech-banking",
  "label": "Fintech / digital bank / payments",
  "kind": "digital",
  "parent": "finance",
  "match": ["fintech", "digital bank", "payments", "wallet", "card", "remittance", "send money", "bank account", "neobank", "payment gateway", "pos"],
  "show": "The real app screens of one flow (send, pay, save), the physical card it issues, a merchant using its terminal, fees and rates stated with date.",
  "proof": ["Real app screens and flows", "Licence and regulator it operates under", "Fees and rates as published, with date", "Security features it really has", "Store rating it holds, with date"],
  "wants": "Fast, cheap, safe money moves, clear fees, an app that just works, and help when something goes wrong.",
  "doubts": "Is it licensed? Is my money safe? Hidden fees, frozen accounts, scams, poor support.",
  "cliches": ["glowing coin hologram", "padlock over a phone", "money flying from a screen"],
  "angles": ["Send money to [country] in the app: here's how", "Our fees, all on one screen", "New: [feature] is live", "How we keep your account safe: [real features]"],
  "carousels": ["Open app -> step 1 -> step 2 -> done -> fees", "Fee table -> what you pay -> what you don't -> licence line", "Scam warning -> signs -> what we never ask -> how to report"],
  "videoArc": "Thumb opens the real app -> the flow in 3 taps -> confirmation screen -> fee and licence line -> download badges",
  "typeVoices": ["geometric-tech", "bold-geo", "classic-trust"],
  "moments": ["Eid / Diwali remittance peaks", "Salary days", "Black Friday / 11.11 shopping", "Back to school fees", "Tax deadlines", "Fraud awareness weeks"],
  "regulated": "Financial promotions rules; show licence; no implied deposit insurance if not a bank; Meta special ad category."
}
```

## telecom-internet

```json
{
  "id": "telecom-internet",
  "label": "Telecom / internet service provider",
  "kind": "service",
  "parent": "local",
  "match": ["internet", "broadband", "fiber", "isp", "wifi", "mobile network", "sim", "data packages", "telecom", "home internet", "5g"],
  "show": "The real package card (speed, price, contract), the installer at a real home, router and coverage map from its own data, the support team.",
  "proof": ["Package prices and terms as published", "Speeds most customers get, measured", "Coverage areas from its own network map", "Named installers and support hours", "Verbatim customer reviews with permission"],
  "wants": "Fast, stable internet at a fair price, quick installation, no surprise bills, and support that answers.",
  "doubts": "Speeds below the ad, outages, long contracts, hidden fees, slow installation, unreachable support.",
  "cliches": ["glowing fibre light streaks", "globe with network lines", "family cheering at a laptop"],
  "angles": ["Now in [area]: [speed] for [price]", "How installation works: booked to online", "Our packages, side by side", "Outage in [area]: here's the update"],
  "carousels": ["Package 1 -> package 2 -> package 3 -> what's included -> check your area", "Book -> installer visit -> router set up -> online -> support line", "Wifi tip 1 -> tip 2 -> tip 3 -> call us"],
  "videoArc": "Installer arrives at a real home -> router set up -> real speed test on the customer's device -> package card -> check-your-area CTA",
  "typeVoices": ["geometric-tech", "bold-geo", "sturdy-grotesk"],
  "moments": ["New area launches", "Back to school", "Ramadan / Eid packages", "Major sports tournaments", "Black Friday", "Work-from-home season"],
  "regulated": "Speed claims must be achievable by most customers (UK ASA); state contract and price terms clearly."
}
```

## online-courses-coaching

```json
{
  "id": "online-courses-coaching",
  "label": "Online courses and coaching",
  "kind": "digital",
  "parent": "education",
  "match": ["online course", "coaching", "coach", "masterclass", "cohort", "mentorship", "bootcamp", "workshop", "program", "learn", "1:1 coaching"],
  "show": "The real coach or teacher on camera, a real lesson screen or module list, a live session clip, a student's own work or words with consent.",
  "proof": ["The coach's real experience and credentials", "Real curriculum and lesson screens", "Free sample lesson or live session clip", "Student work and words with consent", "Refund or guarantee it really offers"],
  "wants": "A clear skill or result, a teacher who knows it, a structured path, support, and fair price.",
  "doubts": "Hype and income promises, recycled free content, no support after paying, refund trouble, fake testimonials.",
  "cliches": ["lambo and laptop lifestyle", "stacks of cash", "rocket-to-success arrow"],
  "angles": ["What you'll be able to do after [module]", "Free lesson: [topic] in [real] minutes", "Inside the course: [n] modules", "Enrolment for [cohort] closes [date]"],
  "carousels": ["Problem -> what you'll learn -> module list -> coach -> enrol", "Tip 1 -> tip 2 -> tip 3 -> free lesson link", "Student work before -> after -> what they learned -> their words"],
  "videoArc": "Coach on camera names the skill -> real lesson screen -> live session clip -> module list -> enrolment date and link",
  "typeVoices": ["personal-note", "bold-geo", "humanist-care"],
  "moments": ["New year goals", "Back to school", "Cohort start and close dates", "Black Friday course sales", "Summer break", "Ramadan learning"],
  "regulated": "No unsupported earnings claims (FTC); results in testimonials must be typical or say what to expect."
}
```

## education-tutoring

```json
{
  "id": "education-tutoring",
  "label": "Tutoring / academy / school",
  "kind": "service",
  "parent": "education",
  "match": ["tutoring", "tutor", "academy", "coaching centre", "o levels", "a levels", "ielts", "test prep", "school", "classes", "home tuition", "admissions"],
  "show": "Real teachers in a real classroom or online session, the timetable and batch start date, a worked example on the board, real results the academy published with students' consent.",
  "proof": ["Named teachers and qualifications", "Results it published, with student consent", "Timetable, batch dates and fees", "Real classroom and facilities", "Parents' and students' words with consent"],
  "wants": "Better grades or a passed exam, good teachers, safe place, flexible timings, progress reports for parents.",
  "doubts": "Big classes, unqualified teachers, rote learning, fees for little progress, safety for children.",
  "cliches": ["graduation cap flying", "rocket of knowledge", "stock kids smiling at laptop"],
  "angles": ["New [subject] batch starts [date]", "[n] weeks to [exam]: this week's focus", "Meet [teacher], [subject]", "Worked example: [topic] in 3 steps"],
  "carousels": ["Exam -> weeks left -> weekly plan -> resources -> register", "Question -> step 1 -> step 2 -> step 3 -> answer -> join class", "Teacher -> subject -> experience -> timings -> fees"],
  "videoArc": "Teacher at a real board solves one question -> students working -> batch start date and timings card -> address and contact",
  "typeVoices": ["rounded-friendly", "humanist-care", "multiscript-soft"],
  "moments": ["Exam seasons", "Result days", "Back to school / admissions", "Summer camps", "Ramadan timings", "Mock exam weeks"],
  "regulated": "Show children only with parent consent; publish only results students agreed to share."
}
```

## nonprofit-charity

```json
{
  "id": "nonprofit-charity",
  "label": "Nonprofit / charity",
  "kind": "service",
  "parent": "local",
  "match": ["nonprofit", "charity", "foundation", "ngo", "donate", "volunteer", "fundraising", "zakat", "welfare", "relief", "community"],
  "show": "Its real work and people with consent: volunteers on site, a finished project, a dated report page, the receipt or spending breakdown it publishes.",
  "proof": ["Photos of its own work, with consent", "Published annual report and accounts", "Registration number and regulator", "Named volunteers and staff", "Impact figures it measured and published"],
  "wants": "To know their money reaches people, how it is used, that it is safe and simple to give, and to see the result.",
  "doubts": "Is it registered? How much goes to admin? Scams in disaster time, exploitative pictures, no follow-up.",
  "cliches": ["hands holding a heart", "crying child close-up", "coins in a jar"],
  "angles": ["What your [amount] did this month", "Meet [volunteer], who [real task]", "[Project] is finished: here's the result", "Where every donation goes"],
  "carousels": ["Need -> what we did -> photos with consent -> result -> donate", "Donation -> where it goes 1 -> 2 -> 3 -> report link", "Volunteer day: arrive -> work -> finished -> join us"],
  "videoArc": "Volunteers at a real site -> the work in progress -> finished result -> one line on spending -> registration number and donate link",
  "typeVoices": ["humanist-care", "warm-serif", "multiscript-soft"],
  "moments": ["Ramadan and zakat season", "Giving Tuesday", "Winter appeals", "Disaster response", "Eid al-Adha (qurbani)", "Year-end giving"],
  "regulated": "Informed, revocable consent for beneficiary images; extra care with children; show registration."
}
```

---

## Cross-sector lessons for services

- **The service has a product: the screen, the deliverable, the room or the person.** For digital work, the truest picture is the real screen in a frame (browser, phone, monitor). For professional work it is the named person plus one plain-language fact. For venues it is the real room on a busy night. Studio should ask for, or reuse, these before it draws anything symbolic.
- **When the business has no media, draw the structure, not a metaphor.** A deadline card, a package table, a step-by-step process, a checklist or a module list is honest, needs no photo, and does the job. These beat a crane, rocket or handshake every time. The words come from the business's own facts.
- **Before/after is the strongest proof shape for creative and dev work.** That means an old site against the new one, an old logo against the new mark, raw against graded footage, an old build against a new build. It only works with the business's own past work, never an invented "before".
- **Real people beat brand-page polish.** LinkedIn thought-leader posts, a recruiter's face on a job, a lawyer's portrait with practice area, a coach on camera. The person must be a real, consenting member of the team, never a generated stand-in presented as staff or clients.
- **Dates make posts true.** Release days, tax deadlines, batch start dates, match times, law changes, coverage launches. One date plus the audience it concerns ("freelancers", "Grade 10", "Valorant players") lands better than a generic benefit line.
- **Numbers only from the business.** Speed scores, campaign results, ratings, placements and impact figures must be the business's own, dated where possible. Never fill a dashboard, a rating or a client logo strip to "look credible".
- **Regulated sectors need structure that can't overclaim.** Law firms can't promise outcomes, and Indian advocates are barred from soliciting. Financial and insurance promotions must be fair, clear and not misleading. Coaches can't make earnings claims. Charities need consent for every beneficiary image. For these sectors, default to explainer, deadline and portrait formats, and keep required lines (licence, registration, disclosure) as verbatim text the person supplies.
- **Platform rules are part of the design.** Steam base capsules carry the logo and art, with no review scores or awards. App store screens must show the real app. Meta treats job, credit and financial ads as special categories with narrower targeting. Studio should carry these as format rules, not leave them to the prompt.
- **Video arcs for services follow one pattern.** A real person or real screen gives the hook in second 1. Then come 2–3 cuts of the work itself, one concrete fact, then the name and the next step. No stock cutaways.
- **Culture moments differ by sector.** For fintech and charity, Ramadan, zakat and Eid are peak giving and remittance moments. Exam and result days matter for education. Patch and tournament weeks matter for gaming. Budget and tax deadlines matter for finance. New-year planning matters for B2B. Map moments per sector, not one calendar for all.

## Sources

| URL | What it taught | Licence / terms |
|---|---|---|
| https://partner.steamgames.com/doc/store/assets/rules | Steam base capsules must show game art plus a readable logo. Review scores, awards, discount text and CTAs are banned. Artwork overrides are limited to 14 days. | Valve Steamworks docs; public, quoted in own words |
| https://howtomarketagame.com/seven-great-tips-for-marketing-your-indie-game-on-tiktok/ | Lead TikTok clips with the most arresting real gameplay frame, and measure wishlists, not views. | Public blog, © author |
| https://findclout.com/blog/how-to-market-an-indie-game-on-tiktok | Menus, tutorials and cutscenes underperform. Clips should be 15–40 s with a first-second hook. | Public vendor blog |
| https://www.gamedeveloper.com/game-platforms/from-400-to-20-000-wishlists-with-1-video-how-tiktok-can-make-your-game-go-viral | Real case: one gameplay video drove wishlists. Dev before/after clips work. | Public article, © Informa |
| https://developer.apple.com/app-store/asset-best-practices/ | App Store screenshots must show the real app in use. Put the strongest benefit first. | Apple developer docs, public |
| https://www.apptweak.com/en/aso-blog/how-to-optimize-your-app-screenshots | Screenshot sets should tell a story, one benefit per frame, localized and tested. | Public vendor blog |
| https://saashero.net/design/best-saas-visuals-b2b-ads/ | Real UI screenshots beat stock in B2B ads. A named customer quote should carry an outcome. | Public agency blog (vendor claims unverified) |
| https://business.linkedin.com/advertise/ads/best-practices/sponsored-content-tips | LinkedIn sponsored content: short intro, refresh creatives, several ads per campaign. | LinkedIn marketing docs, public |
| https://socialmediatoday.com/news/linkedin-shares-tips-on-thought-leader-ads/830359 | Thought Leader Ads boost real people's posts and suit insight, not product pushes. | Public news article |
| https://www.sendible.com/insights/marketing-portfolio | Agency portfolios: easy to find, structured as challenge, strategy, outcome, ending in a CTA. | Public vendor blog |
| https://www.progress.com/blogs/creative-ways-use-social-media-grow-web-design-business | Ways web designers use social media to show work and process. | Public blog |
| https://www.socialpilot.co/?p=728395 | Design agencies should define the audience (for example marketing managers, ecommerce founders) first. | Public vendor blog |
| https://clutch.co/resources/specialized-dev-agency | Buyers struggle to tell deep stack or industry expertise from a single project. Verified reviews and case studies are how they vet. | Public vendor page |
| https://clutch.co/service-provider-content/case-study-Valere | Reviews, case studies and testimonials give buyers evidence before a sales call. | Public vendor page |
| https://www.agorapulse.com/blog/industry/marketing-social-media-agency/ | Agencies sell on measurable client results and campaign breakdowns. | Public vendor blog |
| https://buffer.com/resources/agency-social-content-first/ | An agency's own channel works as its portfolio: show the work and the people. | Public blog, © Buffer |
| https://madebyshape.co.uk/web-design-blog/showcasing-what-we-can-do-branding-projects-before-and-after | Before/after branding showcases built from a studio's own projects. | Public agency blog |
| https://www.underconsideration.com/firstround/category/status/case-study | Real identity case studies show the explorations, rationale and final applications. | Public site, © UnderConsideration |
| https://www.toptal.com/designers/rebranding-consultants/rebrand-case-study | Rebrand case studies need a narrative and the "why" behind each decision, with visual documentation of process. | Public article |
| https://www.canon-europe.com/pro/stories/how-to-make-a-standout-showreel/ | Production firms lead with their strongest real frames in a tight showreel. | Public article, © Canon |
| https://sproutsocial.com/insights/behind-the-scenes-content/ | Behind-the-scenes content showing real people and process builds trust. | Public vendor blog |
| https://filmlifestyle.com/90-days-of-content-ideas-for-video-production-companies/ | Shoot-day BTS and kickoff-to-delivery timelines work as production firms' content. | Public blog |
| https://negativelight.pages.dev/blog/esports-social-media-templates-guide | Esports core templates: match day (opponent, time with timezone, stream link, lineup), roster, results, clips. | Public blog |
| https://www.behance.net/gallery/108753529/Esports-Wales | Real esports template system: roster announcements, schedules and giveaways matched to the stream look. | Behance project, © author; viewed only |
| https://nerdbot.com/2024/04/10/leveling-up-your-gaming-cafe-strategies-for-success/ | Gaming cafes grow through weekly tournaments, leagues and LAN nights, each announced and recapped. | Public article |
| https://finmodelslab.com/products/gaming-cafe-marketing-plan | Facebook events for tournaments and gaming nights drive foot traffic. Branded challenges help. | Public vendor page |
| https://resources.workable.com/tutorial/we-are-hiring-social-media-post | A hiring post needs title, location, pay and benefits, and a clear apply path. | Public vendor resource |
| https://sproutsocial.com/insights/hiring-post-examples/ | Tailor job posts per platform and use a clear CTA. Feature real employees. | Public vendor blog |
| https://careerarc.com/blog/social-media-job-posts-examples | The best job posts double as employer-brand posts. | Public vendor blog |
| https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category | Meta special ad categories (employment, housing, financial products) restrict targeting. | Meta developer docs, public |
| https://www.americanbar.org/groups/law_practice/resources/law-practice-today/2024/september-2024/how-to-avoid-ethical-violations-while-managing-internet-marketing/ | ABA Rule 7.1 bars false or misleading communications, including omissions, on social media. | ABA public article |
| https://www.njcourts.gov/notices/committee-attorney-advertising-opinion-49-use-of-client-endorsements-and-testimonials | Lawyer testimonials need disclaimers and must not create unjustified expectations. | Public court notice |
| https://www.clio.com/resources/legal-marketing/attorney-advertising-rules/ | Advertising rules vary by state, and several are strict on results and testimonials. | Public vendor resource |
| https://www.barandbench.com/news/after-dsk-legal-ads-bci-condemns-lawyers-advertising-services-on-social-media | The Bar Council of India treats social media promotion by advocates as banned solicitation. | Public news article |
| https://www.scconline.com/blog/?p=390773 | BCI digital conduct rules cover promotional reels, testimonials and legal influencers. | Public legal blog |
| https://accountants.intuit.com/taxprocenter/practice-management/social-media-best-practices-for-tax-accountants/ | Tax firms should post deadline reminders for two weeks before each deadline, linked to fuller articles. | Public vendor resource |
| https://www.xero.com/us/accountant-bookkeeper-guides/promote-your-firm-with-social-media/ | Accounting content pillars: tax tips, regulation updates, carousels, team BTS. | Public vendor guide |
| https://www.thetaxadviser.com/issues/2025/aug/from-practitioner-to-influencer-managing-the-risks-of-online-content-for-tax-professionals/ | Tax professionals must keep opinion separate from advice in public posts. | Public journal article, © AICPA |
| https://icai.org/post/advisory-website-guidelines-of-the-institute | The ICAI limits chartered accountants' advertising. Content must inform, not solicit. | ICAI public page |
| https://content.naic.org/sites/default/files/model-law-570.pdf | NAIC model rules on insurance advertising: no misleading statements about cover. | NAIC public model law |
| https://www.insurancejournal.com/research/research/the-use-of-social-media-in-insurance/ | Insurers' marketing policies must cover social media activity. | Public article |
| https://www.sec.gov/resources-small-businesses/small-business-compliance-guides/investment-adviser-marketing | The SEC marketing rule allows testimonials only with disclosure, oversight and disqualification checks. | US government, public domain |
| https://www.kitces.com/blog/sec-marketing-rule-ria-investment-adviser-testimonial-endorsement-promoter-third-party-rating/ | Practical reading of the SEC rule for advisers' social posts and reviews. | Public blog, © Kitces |
| https://www.fca.org.uk/publications/finalised-guidance/fg24-1-finalised-guidance-financial-promotions-social-media | FG24/1: promotions on social media (memes, reels included) must be fair, clear, not misleading. Influencers need approval. | FCA public guidance |
| https://www.fdic.gov/deposit-insurance/fdic-official-signs-and-advertising-requirements-false-advertising | Non-banks must not imply FDIC insurance. The rules cover digital and social channels. | US government, public domain |
| https://www.asa.org.uk/advice-online/broadband-and-telecoms-speed-claims.html | UK broadband speed claims must be achievable by about 50% of customers at peak (2018 rule). | ASA public guidance |
| https://www.asa.org.uk/resource/broadband-speed-claims-guidance.html | CAP/BCAP 2018 broadband guidance replaced the older "up to" basis. | ASA public guidance |
| https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials | The FTC bans fake or bought reviews and testimonials. Atypical results need disclosure. | US government, public domain |
| https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-proposes-rule-changes-new-rule-deter-deceptive-earnings-claims-multilevel-marketers-money-making | The FTC proposed rules covering coaching and course earnings claims. | US government, public domain |
| https://www.ftc.gov/news-events/news/press-releases/2026/04/publishingcom-pay-15-million-misleading-consumers-about-how-much-income-they-could-earn-using | Enforcement against a course seller for misleading income claims. | US government, public domain |
| https://tdtickets.tutordoctor.com/portal/en/kb/articles/exam-preparation-marketing-guide-sa | Tutoring firms post testimonials and study-tip infographics in the run-up to exams. | Public franchise guide |
| https://www.squarespace.com/blog/how-to-market-a-tutoring-business | Re-engage families at the start of school year or exam season. | Public vendor blog |
| https://www.socialmon.ai/blog/71-tutoring-center-instagram-post-ideas-with-examples | Exam countdown series, exam-stress posts and revision reels timed before exams. | Public vendor blog |
| https://www.oscr.org.uk/media/minlfufm/ready-set-go-social-media-guidance.pdf | Charity social media: informed, specific, time-limited consent. | OSCR (Scottish regulator) public guidance |
| https://www.bond.org.uk/wp-content/uploads/2024/11/Digital_Ethical-Guidelines_FINAL.pdf | Ethical digital guidelines for NGOs: dignity and consent in stories. | Bond public PDF |
| https://cl.globalgiving.org/nonprofit-partner-handbook-static/GG_CommunityPhotoStandards.pdf | Get consent after explaining the use, with community facilitation. | GlobalGiving public PDF |
| https://www.scu.edu/ethics/ethical-dilemmas-in-the-social-sector/ethical-storytelling-on-social-media/ | People shown should help shape how they are represented. Avoid saviour framing. | Public article, © Santa Clara University |
