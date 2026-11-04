# ADR-0044: Mellox 2.0 — the Mox frame, Home bento and content language

Status: accepted (2026-11-04)

## Context

The app had a long feature sidebar, a dark default, windows that each looked
different, and nothing that carried a person from sign-up to their first post.
We rebuilt the look on the structure of Holo AI's app (studied frame by frame),
in Mellox's own colours and with our own mascot, Mox.

## Decision

- **Frame.** Every app screen is a white window (`AppFrame`, `ds-frame`) on
  Mox's gradient (`ds-backdrop`). Light is the default theme; dark keeps the
  same layout. The landing page is untouched (no `data-mellox-app`).
- **Mox is the guide.** `Mox` (3D renders) and `MoxFace` (drawn, with moods)
  replace the logo in greetings, chat, loaders, empty and error states, the
  tour and onboarding. `StarAgent` is gone.
- **Gradient is rationed:** backdrop, primary pill, progress bars, Mox's visor
  and gradient headline words only.
- **Sidebar as data** (`src/lib/shell/nav.ts`): Workspace (Home, Chat), Brand,
  Create, Grow, Team. Chat has its own entry (`chatPath`, `?view=chat`) with
  conversations on the right; "Reddit agent" is shown as Communities.
- **Home is a bento** (`HomeBento`) above the real message box. Cards only open
  existing places through `useOpenCreate` (the same logic as the Create
  launcher, including plan locks); none starts paid work. Start here
  (`src/lib/home/start-here.ts`) counts free reads only.
- **Content language.** Onboarding has a Language step (review → language →
  products) and Settings → Language. The choice is an English label stored in
  `dna.look.writing.language` (`src/lib/brand-look/languages.ts`) and reaches
  every generator through `lookTextFor`. The app's own text stays English. No
  migration.
- **Entry.** Onboarding ends with press-and-hold (`HoldToEnter`) and the visor
  cinematic (`VisorTransition`), then `StartHereModal` on Home
  (`sessionStorage["mox:entered"]`). Reduced motion is a plain fade.
- **Motion** is allowed to be lively (stagger, tilt, springs, Mox blinking and
  floating) but always off with reduced motion.

## Consequences

- `docs/design-system.md` replaces "never a gradient" and "nothing bounces"
  with the rules above.
- Labs: `/home-lab`, `/onboarding-lab?step=language|finish&beat=…`,
  `/projects-lab`, `/tour-lab`.
- Specs that looked for the old placeholder now find the composer by its name,
  "Message Mellox".
