# Mellox landing page rebuild: the session prompt

Paste everything below the line into a new Claude Code session opened on this
repository. Use the highest model and the highest effort.

---

You are rebuilding the public Mellox AI website from scratch: the home page
first, then the shared navbar, footer and CTA band so every marketing page
matches. This is a long task, so take your time. Research first, plan, make the
media, build, then check every section in a real browser. Quality matters more
than speed or token use. Think hard at every step.

## 0. Read this first (do not skip)

1. Read `CLAUDE.md`, `docs/design-system.md` and `docs/adr/0044-mellox-2-mox.md`.
   The app was redesigned as **Mellox 2.0 / Mox**. The website still has the old
   dark aurora look (`bg-[#030405]`, pink/purple aura gradients). Your job is to
   bring the website into the Mox world.
2. This version of Next.js (16, App Router) is different from your training data.
   Read `node_modules/next/dist/docs/` before you use any Next API (images, fonts,
   metadata, `"use client"` boundaries, video).
3. Note: `CLAUDE.md` says the landing page is `src/app/page.tsx` and must never
   be restyled "as part of app UI work". This task **is** the landing page work,
   so that rule doesn't block it. The real files are:
   - page: `src/app/(marketing)/page.tsx`
   - layout: `src/app/(marketing)/layout.tsx` (Preloader, MotionGate, SmoothScroll
     with Lenis, CookieBanner, Analytics, `Micro_5` font)
   - components: `src/marketing/components/*` (Navbar, Footer, HeroBackground,
     HeroWall, Brains, Workflow, Problems, Faq, CustomerMap, Clients, pricing/*,
     cta/CtaBand, whats-new/*)
   - styles: `src/marketing/globals.css` and the per-component `*.css`
   - SEO: `src/marketing/lib/seo.ts`, `faqs.ts`, `JsonLd`, `sitemap.ts`, `llms.txt`
4. Keep everything that isn't visual: metadata, JSON-LD, the canonical URL,
   `LandingGate` (signed-in people go to `/projects`), the cookie banner,
   analytics, skip link, the sitemap and every route under `(marketing)`. Delete
   the old home sections only after the new ones replace them. Don't leave dead
   components or CSS behind.
5. Work on a new branch, for example `website-mox-rebuild`. Don't touch app code
   under `src/components/app/**` or `src/server/**`.

## 1. Research the references (in the built-in browser, not from memory)

Open **https://native.no** (main reference) and **https://tryholo.ai** (second
reference) in the built-in browser. Scroll each one slowly, top to bottom, at
desktop and mobile widths. Take screenshots. Use `javascript_tool` to read the
real fonts, colours, spacing, section heights, which elements are pinned
(`position: sticky`), and how scroll animations are driven (GSAP ScrollTrigger,
Framer, CSS scroll-timeline, video `currentTime` scrubbing). Record hover and
cursor effects.

Write what you learn in `docs/landing/reference-study.md`: section order,
headline length, rhythm, how much text, what moves and when, and what makes each
page feel premium. Then decide what Mellox takes from each one.

What a quick read of both pages already showed (check it yourself):

- **Native** is calm and editorial. It has a very short hero headline
  ("Your marketing assistant."), one or two sentence sub-lines, and real posts
  as the main visual (a large "Made with Native" wall). It has a template chip
  row as a low-friction start, a logo strip, one named case study, a stat row,
  and tabbed "what it makes" (Social / Design / Ads / Images / Writing). It
  promises "first posts free, no card". Its text is plain, sentence case and
  short.
- **Holo** is denser and more playful. It has mascots in many sections, a
  rating chip in the hero, a looping conveyor of creatives, count-up stats, a
  five-step "How it works", "Proactive. No prompt needed." suggestion cards, an
  "any niche / any language / any integration" block, a FAQ with a mascot
  ("Skeptical? Good.") and one big final CTA.

**Mellox takes Native's calm, airy layout and short copy, and Holo's character
energy, but with our own character (Mox), our own gradient and our own real
posts.** Build an original page. Don't copy either site's text, layout pixels,
images, customer quotes, logos or numbers. Holo is a direct competitor: never
name either site on the page.

## 2. Who Mellox is (the message)

Mellox is **marketing on autopilot**: an AI social media manager and marketing
team for small brands. You paste your website. Mox (our guide) learns the brand
(Brand DNA, Audience, Competitors, Market: "four brains"). Then it plans, makes
and posts image posts, carousels, Stories, videos, Creator (UGC) video ads, ads
and blog articles. It also gets your site cited by AI search (AI Visibility /
GEO). Nothing goes out until you approve it, unless you turn on full Autopilot.

Read the product docs for exact facts: `docs/brain.md`, `docs/autopilot.md`,
`docs/campaigns.md`, `docs/studio/video.md`, `docs/geo-intelligence.md`,
`src/marketing/lib/faqs.ts`, `src/marketing/content/user-guide.md`.

Copy rules:

- **Crisp.** A headline is 2 to 6 words. A sub-line is one sentence, two at
  most. No paragraph over 25 words on the home page. Sentence case. No emoji.
- Plain words, active voice, second person ("Mox posts while you sleep."). No
  "revolutionise", "unleash", "seamless", "supercharge" or "game-changer".
- **Honest.** Never invent a customer count, rating, testimonial, revenue
  figure, ROAS, investor or badge. Only use numbers the product really has:
  plans and prices come only from `src/lib/billing/catalog.ts` (Starter $49,
  Growth $149, Agency $399; yearly $39 / $119 / $319 a month; 150 / 500 / 1,500
  credits; 1 credit = 1 image post; trial codes need a card; there is no Free
  plan). Read those values from the catalog in code; never type them by hand.
  Where real proof doesn't exist yet, show real output (posts) instead of fake
  social proof.
- Draft two or three headline options for each section in
  `docs/landing/copy.md` and pick the strongest. Starting ideas, not final:
  hero "Marketing on autopilot." / "Meet Mox. Your marketing team."; sub-line
  "Paste your website. Mox plans, makes and posts your content every day. You
  just approve."

## 3. The look (Mox world, light first)

- **Light, airy, white** like the new app (`AppFrame` / `AppCanvas`), not the old
  black aurora. Big white space, rounded 28px windows, 20px tiles, pill buttons,
  hairlines and soft shadows only on windows.
- **Colour tokens** (already in `src/styles.css`, reuse them, don't redefine):
  `--mox-gradient` (#d9f53a → #9cf03f → #3fe46e → #1fd6c4), `--mox-visor`,
  `--mox-backdrop` (lime → green → cyan → blue wash), `--mox-ink` #16191b,
  `--mox-lime` #c6f24e, `--mox-cyan`, `--mox-blue`. Ink text on white.
- **Gradient is rationed** (ADR-0044): the soft canvas wash, the primary pill,
  progress bars, Mox's visor and one or two headline words. A primary button is
  the Mox gradient with ink text. Never use a flat neon-lime pill.
- **Type:** the app uses Google Sans Flex (`--font-google-sans-flex`) with
  Michroma for accents (`src/app/layout.tsx`). Use Google Sans Flex for the site
  at big, tight display sizes (variable weight and width are animatable), and
  Michroma only for small labels or numbers. Decide whether `Micro_5` still
  earns its place.
- **Icons:** `@/components/icons` (the bespoke Mellox set), with lucide as a
  fallback. Social networks appear as their app icons (`PlatformAppIcon`,
  `src/components/brand/`). App logos come from `brand/AppLogo.tsx` and
  `public/logos/`. Never draw a look-alike logo.
- **No emoji and no generic star or sparkle PNGs.** Brand visuals are Mox, the
  Mellox icons and real Mellox posts.

## 4. Assets already in the repo (use them)

- **Mox renders** `public/brand/mox/`: `hero.webp` (3/4 on the gradient),
  `face.webp`, `face-head.webp`, `wave.webp`, `visor.webp`, `visor-head.webp`.
  Components: `Mox`, `MoxFace` (moods), `VisorTransition`
  (`src/components/brand/mox/`).
- **Mox poses** `public/brand/mox/onboarding/`: `pose-calendar`, `pose-jump`,
  `pose-magnifier`, `pose-relax`, `pose-thinking`, `pose-thumbs`, goal art
  (`goal-sales`, `goal-leads`, `goal-reach`…), role art, tone art,
  `world-day`, `world-finish`.
- **Four brains art** `public/brand/brains/*-a.svg / *-b.svg` (brand, audience,
  competitors, market).
- **Real Mellox posts** `public/Home/wall/` (54 files: build, burger, classes,
  finance, milk, sunscreen, wallet…) and `public/Home/Hero.webp`.
- **Videos** `public/Home/wall/reel-1..4.mp4`, `skin-fix.mp4`,
  `website-losing-customers.mp4`, `logo-motion.mp4`.
- **Mox promo film frames** `public/promo-mox/clip-meet`, `clip-tired`,
  `clip-always`, `clip-orb`, `clip-finale`, `reel-1..4`, `still/` (about 600
  numbered JPG frames). These are ready-made **scroll-scrub frame sequences**.
  The film's scene code is in `src/components/promo/mox/`.
- **Creator faces** `public/creators/*.jpg` (original, fictional people).
- Micro icons `public/brand/micro/` (Asterisk, At, Hash, Percent).

## 5. New media to generate (wait for my go-ahead)

**Don't make any paid image or video until I give you the generation tool and
say yes.** I will connect Higgsfield (the `mcp.higgsfield.ai` server). Before
each batch:

1. Check the balance.
2. List every asset with its model, size or length, and its price in **USD**,
   plus the batch total.
3. Wait for my yes.

Start with one test of each kind, show it to me, then run the rest.

Plan the media in `docs/landing/media-plan.md`. Mox must look exactly like the
existing renders: use `hero.webp`, `face.webp` and `wave.webp` as character
references every time. Also keep the same 3D material, the visor and
proportions, and always use the Mox gradient world. Suggested set:

- **Hero film.** A 6 to 10 second loop. Mox in the gradient world, with posts,
  carousels and Story frames orbiting and landing in a phone. Deliver a
  seamless loop. Also export it as a JPG/WebP frame sequence for scroll scrub.
- **Mox in motion**, image-to-video from the existing renders: waving, putting
  on the visor (scan), thinking, thumbs up, jumping, typing on a laptop,
  pinning posts on a calendar, sleeping in a hammock while posts go out
  ("autopilot"). Make each one a cut-out or deliver it on a flat key so it sits
  on white.
- **"Paste your website" sequence.** A website page breaking into Brand DNA
  colours, fonts and products, which flow into four brain orbs.
- **Format shots.** Each format (image post, carousel, Story, Reel, UGC video,
  ad, blog article, AI search answer) is shown by a real-looking Mellox output
  in a phone or browser frame. Prefer real outputs from `public/Home/wall` and
  fill gaps with generated ones.
- **Section backdrops.** Soft Mox-gradient light fields and blurred orbs at
  2560px, plus a subtle noise texture.
- Encode every video as H.264 MP4 plus a WebM/AV1 version with a poster frame.
  Keep each under about 3 MB where possible, and make a short mobile cut. Turn
  frame sequences into WebP at 2 widths. Save to `public/site/…`, not to C:
  (the C: drive is full and G: is tight, so put temp files on H:).

## 6. The page (build from scratch)

Proposed order. Change it if your research gives you a better one, and say why.

1. **Nav.** Floating white glass pill. Mellox mark, links Features, Use cases,
   Pricing, Blog, then "Log in" and the gradient "Start" pill. It shrinks on
   scroll and hides on scroll down and shows on scroll up. Mobile gets a
   full-screen sheet with staggered links.
2. **Hero.** A short headline (word-by-word mask reveal, one gradient word),
   one sub-line, and a "Paste your website" pill field with the Start button
   (it hands off to signup with the URL kept, as the current `HeroChat` does;
   check how). Beside it or behind it is the Mox hero film. Mox's eyes or head
   follow the pointer (see `MoxFace`). Underneath goes a format chip row
   (Image post, Carousel, Story, Reel, Creator video, Ad, Blog), like Native's
   template chips.
3. **Meet Mox.** A pinned, scroll-scrubbed section. As you scroll, Mox puts on
   the visor and "reads" a website, using the `promo-mox` frames or the new
   film. Three short lines appear one at a time: learns your brand, plans your
   month, posts every day.
4. **Four brains.** Brand DNA, Audience, Competitors and Market as four orbs
   that fill as you scroll. Each one gets a 3 to 5 word line and a small live UI
   peek.
5. **Made with Mellox.** A masonry wall of real posts at their true shape (no
   cropping, see `src/lib/library-grid.ts`). The columns drift at different
   speeds (parallax). Videos play only while visible. On hover a tile lifts and
   tilts up to 4° and shows the format and platform icon.
6. **Everything it makes.** Sticky tabs (Posts / Carousels / Stories / Videos /
   Creator ads / Ads / Articles / AI search). The visual swaps with a
   cross-fade and spring. Each tab has one line and one real example.
7. **Autopilot.** "Marketing on autopilot." A week calendar fills itself as you
   scroll: posts drop in, Mox approves, platform icons light up as they post.
   Mox relaxes in a hammock. Make it clear that you approve, or let it run.
8. **How it works.** Three or four steps: paste site → pick a goal → approve
   the plan → it posts and learns. Use a horizontal scroll on desktop (pinned
   section that moves sideways) and a vertical stack on phones.
9. **Works where you post.** A loop of real platform and app icons
   (`PlatformAppIcon`, `AppLogo`), any language (Mox writes in 90+ languages;
   check the real list in `src/lib/brand-look/languages.ts`) and any industry.
10. **Pricing.** Three plan cards from the catalog, a monthly/yearly toggle
    with a number roll, and the credit line explained simply. Link to
    `/pricing`. Reuse the logic in `src/marketing/components/pricing/`, but
    restyle it.
11. **FAQ.** Mox sits beside it in a thinking pose. Use an accordion with a
    spring and keep the FAQ JSON-LD.
12. **Final CTA.** A big gradient canvas, Mox waving, a 3 to 5 word line and
    the "Paste your website" field again.
13. **Footer.** Calm, white, columns of links (keep every existing route), and a
    giant "Mellox" wordmark that reveals as you reach the bottom.

## 7. Motion, effects and the cursor (make it feel alive)

- **Tools.** Lenis is already installed (smooth scroll), along with Framer
  Motion. Add **GSAP + ScrollTrigger** for pinned and scrubbed sections, and
  connect it to Lenis (`lenis.on('scroll', ScrollTrigger.update)` with GSAP's
  ticker). Only add WebGL (`ogl` or three.js) if it clearly beats CSS. Keep it
  to one canvas at most, lazy-loaded, with a static fallback. Ask before adding
  anything heavy.
- **Scroll-driven video, not autoplay.** Hero and feature films are scrubbed by
  scroll. Draw a pre-loaded frame sequence to a `<canvas>` (the most reliable
  way). If you use `<video>`, encode it with every frame as a keyframe so
  seeking `currentTime` is smooth. Preload the first frames, then stream the
  rest.
- **Effects to use well, not all at once:** word and line mask reveals;
  gradient words that shift slowly; a gently drifting `--mox-backdrop` wash;
  blurred colour orbs that follow the scroll; parallax layers on Mox; magnetic
  buttons; a shine sweep on the primary pill; count-up only on real numbers;
  marquee rows that slow on hover; card tilt toward the pointer; soft noise
  grain; and section-to-section colour transitions.
- **Cursor.** A small ink dot with a soft trailing ring (spring). It grows and
  says "Play", "Drag" or "Open" over videos, sliders and tiles. Over a post it
  becomes a tiny Mox face. Use it only on fine pointers (`(pointer: fine)`), and
  keep the system cursor on text fields.
- **Mox is alive everywhere.** He blinks, floats, looks at the pointer, reacts
  when a button is hovered (happy face), and waves when the final CTA comes
  into view. Reuse the `MoxFace` moods and `mox-float`.
- **The preloader.** Replace the current one with a short (≤1.2 s) Mox visor
  light-up that wipes into the hero. Skip it on repeat visits.
- **Easing.** Use `--ds-ease` `cubic-bezier(0.16, 1, 0.3, 1)` and springs.
  Nothing linear and nothing that bounces too much.
- **Respect reduced motion.** With `prefers-reduced-motion` (and the existing
  `MotionGate`), turn off scrubbing, parallax, the cursor and marquees. Show
  posters and static frames instead. Every piece of content must still be
  readable.

## 8. Performance, access and SEO (not negotiable)

- Lighthouse on mobile: Performance ≥ 85, Accessibility ≥ 95, Best Practices
  and SEO ≥ 95. LCP under 2.5 s, CLS under 0.05, and no long tasks over 200 ms
  while scrolling.
- The hero headline must be server-rendered text (good for LCP and SEO), never
  canvas. Videos and frame sequences load lazily and pause off screen.
  Use `next/image` with sizes. Fonts use `display: swap` and are subset.
- Semantic headings (one `h1`), alt text, focus rings, keyboard access for tabs
  and the FAQ, AA contrast on the gradient (ink text, never white on lime).
- Keep `metadata`, the OG and Twitter images (regenerate them in the new look),
  JSON-LD, `llms.txt` and the sitemap. Update copy in `seo.ts` only where the
  message changed.

## 9. How to work

1. Research (section 1) → `reference-study.md`.
2. Write `copy.md`, `media-plan.md` and a section-by-section build plan with
   the motion spec for each section. Show me a short summary and the media
   cost. Then wait for my go-ahead and the generation tool.
3. Build the base first: tokens, fonts, Lenis + GSAP wiring, cursor, nav,
   footer, the section frame and reduced-motion handling.
4. Build the sections one by one. For each one, use the `verify` launch config
   (or `npm run dev` on :8080) through `preview_start`, scroll it in the
   built-in browser at 1440, 1024, 768 and 375 widths, screenshot it, and fix
   it before you move on. Compare the feel with native.no side by side.
5. Make the media after I approve the cost, put it into the sections, and
   check it again.
6. Check the rest of the marketing pages (pricing, features, use-cases, blog,
   about, compare…). The shared nav, footer and CTA must look right on all of
   them, with no old dark aurora left.
7. Finish with `npm run typecheck && npm run lint && npm test && npm run build`,
   Lighthouse on mobile and desktop, a reduced-motion pass, and a keyboard
   pass. Send me screenshots and a short screen recording (GIF) of the scroll.
8. Don't commit or push until I say so. When you report, say plainly what
   you could not verify.

The bar: someone who opens the site should get in 5 seconds that Mox is their
marketing team on autopilot, want to scroll just to see what moves next, and
find it calmer and cleaner than both references.
