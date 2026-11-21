# Mellox design system

**Mellox 2.0** ([ADR-0044](adr/0044-mellox-2-mox.md)) puts the app in a white
window on Mox's gradient, with Mox, the mascot, as the guide everywhere. Light
is the default theme. The section "Mellox 2.0: frame, Mox and motion" below
wins where it disagrees with an older rule.

One look for the whole app, in the Pinterest language: the content is the
interface, pictures sit at their true shape in rounded pins, every control is a
pill, and there is very little text. It keeps Mellox's own brand: **Ultra Moss lime is the only accent colour, in both themes**, and icons
come from the bespoke set in `@/components/icons`.

The public landing page (`src/app/page.tsx`) is not part of this system and
must not change when the app's styling does (see "Scope" below).

## Principles

1. **One question per screen.** A surface with several sections uses a rail;
   each page answers one thing and has one heading.
2. **Show, don't explain.** Numbers, rings, logos and status dots instead of
   paragraphs. Copy is plain and short (see `plain-user-facing-copy`).
3. **One primary action per screen.** Lime pill. Everything else is a quiet
   outlined pill or an icon button.
4. **Soft, not boxed.** Tiles have a hairline and a faint fill; no heavy
   borders and no shadows at rest. A tile that opens something lifts a
   little on hover, like a pin; windows carry the only standing depth.
5. **Pictures first.** Anything visual is a pin in a masonry wall, never a
   cropped thumbnail in a fixed grid.
6. **Alive, not busy.** Pages fade up; cards rise in a short stagger and tilt
   up to 4° toward the pointer; windows open on a soft spring; Mox blinks,
   floats and looks at the pointer. Reduced motion turns all of it off.

## Tokens (`src/styles.css`, "Mellox surface system")

| Token                                 | Use                                                  |
| ------------------------------------- | ---------------------------------------------------- |
| `--ds-radius-window` 28px             | popup windows                                        |
| `--ds-radius-tile` 20px               | tiles and cards                                      |
| `--ds-radius-well` 16px               | soft fills                                           |
| `--ds-tile-bg` / `--ds-tile-border`   | tile surface, per theme                              |
| `--ds-well-bg` / `--ds-well-bg-hover` | segmented controls, quiet rows, fields               |
| `--ds-window-shadow`                  | the only elevation in the system                     |
| `--ds-glow`                           | the lime halo                                        |
| `--ds-ease`                           | `cubic-bezier(0.16, 1, 0.3, 1)` for every transition |

## Utilities

| Class           | What it is                                   |
| --------------- | -------------------------------------------- |
| `ds-window`     | a popup window (radius, hairline, depth)     |
| `ds-glow`       | the Mellox lime halo behind a window or hero |
| `ds-tile`       | the basic content surface                    |
| `ds-tile-hover` | a tile that opens something                  |
| `ds-well`       | soft inset fill                              |
| `ds-page-title` | the one heading on a page (20px semibold)    |
| `ds-label`      | short sentence-case heading above a group    |
| `ds-enter`      | how a page arrives                           |

## Pinterest language

| Pinterest trait                 | Mellox rule                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| The content is the interface    | Light theme is a white canvas with neutral greys (in-app only); dark stays black               |
| Pins at their true shape        | `Masonry` + `PinCard`, 20px radius, `object-contain`, 12px gutters, columns by container width |
| Hover reveals actions           | White round `PinButton`s on a bottom gradient; always visible on touch                         |
| Boards                          | `BoardCover` (one large + two small pictures), a 13px title and one 11px meta line             |
| Everything is a pill            | Buttons, fields, selects, tabs, chips and nav rows are round; menus are `rounded-2xl`          |
| Search and chips above the wall | `SearchPill`, `PillTabs`, `PILL_SELECT`, `Chip` / `ChipRow` (scrolls sideways)                 |
| Very little text                | One title per screen, labels of one to three words, no subtitles or description paragraphs     |

Type scale: 11px meta · 12px controls · 13px card titles · 15px window title ·
20px page title.

### The pin kit (`src/components/app/pins/`)

- `Masonry` places items in the shortest column (`src/lib/library-grid.ts`).
- `PinCard` is the frame: a click target over the whole picture, `topLeft` /
  `topRight` badges (`PinBadge`), hover `actions` (`PinButton`), an
  `overlay`, and a `footer` (`PinFooter`: title + one meta line). Pass
  `content` to draw something other than a picture.
- `PillTabs`, `SearchPill`, `PILL_SELECT`, `PILL_TRACK`, `Chip`, `ChipRow`,
  `BoardCover` and `PinGridSkeleton` are the controls around a wall.
- The Library (`LibraryTile`) is the reference: hearts, download, share and a
  ••• menu on a `PinCard`.

## Components

- **Windows:** `AppModalShell` (`src/components/app/AppModalShell.tsx`). Sizes
  `sm`, `md`, `lg`, `xl`, and `2xl` for data-heavy surfaces. The header is
  a gradient icon tile and a bold 17px title; a `description` is read to
  screen readers only. It opens on a soft spring over a light blur.
  The window focuses itself on open, so no button opens wearing a focus ring.
- **Rail layout:** `SurfaceLayout`, `SurfacePage`, `Tile`, `Stat`,
  `GroupLabel` (`src/components/app/surface/SurfaceLayout.tsx`). Used by AI
  Visibility, Analytics, Backlinks, Competitors and Settings.
- **Buttons:** `<Button>` from `@/components/ui/button`, or the class strings
  in `src/components/app/surface/buttons.ts` (`dsPrimaryBtn`, `dsGhostBtn`,
  `dsIconBtn`) where a plain element fits better. In the app every button is a
  pill.
- **Site and engine marks:** `SiteIcon` (a website's favicon with a monogram
  fallback) and `EngineMark` (ChatGPT, Claude and Gemini logos).
- **Primitives:** tabs are a soft segmented pill; inputs and select triggers
  are pills and textareas are tile-rounded, with a soft fill; menus and popovers are rounded with
  rounded items; tooltips are neutral (never lime); `EmptyState` /
  `ErrorState` show Mox's face (`mox` mood, the icon as a small badge) at
  full size and the icon alone at `sm`.

## Colour

- Lime (`--primary`) for the active item, focus and the glow.
- Mox's gradient (lime → green → cyan → blue) only on: the frame backdrop,
  the primary pill (`ds-grad-pill`, ink text), progress bars
  (`ds-grad-bar`), Mox's visor, and gradient headline words
  (`ds-grad-text`). Nowhere else.
- Status colours (`success`, `warning`, `destructive`, `info`) only for state.
- Colour that carries meaning stays: brand marks of other companies, persona
  accents, status chips, charts.

## Scope

In-app overrides (every `Button`, `Input` and `SelectTrigger` as a pill, and
the white light-theme canvas) apply only when the page
contains an element with `data-mellox-app`: the workspace shell, projects,
agency, onboarding and every `AppModalShell` window set it. The landing page
does not, so it renders exactly as before.

## Mellox 2.0: frame, Mox and motion

- **Frame:** `AppFrame` (`src/components/app/shell/AppFrame.tsx`) wraps the
  workspace shell, Projects and sign-in: `ds-backdrop` gradient, a white
  `ds-frame` window (26px radius, 14px inset; full-bleed on phones) and a
  faint `ds-aurora`. Onboarding uses the same parts.
- **Sidebar as data:** `src/lib/shell/nav.ts` (groups Workspace, Brand,
  Create, Grow, Team), drawn by `SidebarNav`. Add an entry there, keeping its
  `data-tour` value, event and plan lock. The bottom is `MoxGauge` (credits),
  the workspace switcher and the account menu.
- **Mox:** `Mox` (3D renders in `public/brand/mox/`: visor, face, hero, wave)
  for heroes, and `MoxFace` (drawn SVG; moods happy, thinking, wow, sad,
  sleep, excited, scanning; `visor`, `track`) for avatars, loaders, empty
  states, the tour and toasts. `MoxSpeech` is Mox with a speech bubble.
- **Home** is `HomeBento` (`src/components/app/home/`) above the docked
  message box: greeting, Start here, Swipe ideas, Autopilot, Most popular and
  Post / Video / Article cards with glass `Illustration`s. Every card opens an
  existing place through `useOpenCreate`; nothing paid starts from a card.
  `/home-lab` renders it (scenes `done`, `waiting`, `modal`, `language`,
  `states`, `faces`).
- **Type:** page headings 22–28px bold, card titles 16–18px bold, body
  12–13px. Fewer words.
- **Toasts** are white cards top-right (top-centre on phones).
- **Entry:** onboarding ends with `HoldToEnter` and the `VisorTransition`
  (Mox waves, puts the headset on, the camera flies through the visor), then
  `StartHereModal` on Home. Reduced motion is a plain fade.

## Checklist for a new surface

- [ ] Opens in `AppModalShell` (or a route that renders one)
- [ ] More than one section? Use `SurfaceLayout`
- [ ] One `ds-page-title` per page, no subtitles or explanatory paragraphs
- [ ] Pictures are pins (`PinCard` in `Masonry`), never cropped thumbnails
- [ ] One primary action (gradient pill)
- [ ] Tiles are `Tile` / `ds-tile`; no ad-hoc borders or shadows
- [ ] Works at 390px wide and in light and dark
