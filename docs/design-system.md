# Mellox design system

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
6. **Calm motion.** Pages fade up 6px; the rail highlight slides; nothing
   bounces. Reduced motion turns it off.

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
  an icon chip (lime, round) and a title; a `description` is read to screen
  readers only.
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
  rounded items; tooltips are neutral (never lime); empty states use a
  lime-tinted icon.

## Colour

- Lime (`--primary`) for the primary action, the active item, focus and the
  glow. Never a gradient to blue or purple.
- Status colours (`success`, `warning`, `destructive`, `info`) only for state.
- Colour that carries meaning stays: brand marks of other companies, persona
  accents, status chips, charts.

## Scope

In-app overrides (every `Button`, `Input` and `SelectTrigger` as a pill, and
the white light-theme canvas) apply only when the page
contains an element with `data-mellox-app`: the workspace shell, projects,
agency, onboarding and every `AppModalShell` window set it. The landing page
does not, so it renders exactly as before.

## Checklist for a new surface

- [ ] Opens in `AppModalShell` (or a route that renders one)
- [ ] More than one section? Use `SurfaceLayout`
- [ ] One `ds-page-title` per page, no subtitles or explanatory paragraphs
- [ ] Pictures are pins (`PinCard` in `Masonry`), never cropped thumbnails
- [ ] One lime primary action
- [ ] Tiles are `Tile` / `ds-tile`; no ad-hoc borders or shadows
- [ ] Works at 390px wide and in light and dark
