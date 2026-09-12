"use client";

/**
 * Mellox glyphs — the bespoke set.
 *
 * These are the icons that carry the product's voice or appear often enough
 * that their drawing defines how the UI feels: the AI mark, the spinner, the
 * confirm/dismiss pair, navigation arrows, and the everyday object icons.
 * Everything outside this file falls through to lucide via `./index`.
 *
 * Drawn on a 24×24 grid, shapes inside a 20×20 optical box, 1.75 stroke,
 * round caps and joins. See `./icon-base.tsx` for the house style.
 */

import * as React from "react";
import { createIcon } from "./icon-base";

/* ── The AI mark ──────────────────────────────────────────────────────────
   A four-point star with two smaller companions. This is the single most
   used icon in the product and stands in for "Mellox is doing something
   intelligent", so it is drawn deliberately: the large star is asymmetric
   (taller than wide) which reads as motion rather than as a snowflake.   */
export const Sparkles = createIcon(
  "sparkles",
  <>
    <path d="M12 3.2c.55 2.9 1.35 4.5 2.6 5.55C15.85 9.8 17.4 10.3 19.6 10.6c-2.2.3-3.75.8-5 1.85-1.25 1.05-2.05 2.65-2.6 5.55-.55-2.9-1.35-4.5-2.6-5.55C8.15 11.4 6.6 10.9 4.4 10.6c2.2-.3 3.75-.8 5-1.85C10.65 7.7 11.45 6.1 12 3.2Z" />
    <path d="M18.6 15.4c.28 1.2.78 1.75 2 2.05-1.22.3-1.72.85-2 2.05-.28-1.2-.78-1.75-2-2.05 1.22-.3 1.72-.85 2-2.05Z" />
    <path d="M5.6 3.2c.22.95.6 1.38 1.55 1.6-.95.22-1.33.65-1.55 1.6-.22-.95-.6-1.38-1.55-1.6.95-.22 1.33-.65 1.55-1.6Z" />
  </>,
);

/** Wand — "generate this for me". Paired visually with Sparkles. */
export const Wand = createIcon(
  "wand",
  <>
    <path d="M4.6 19.4 13.2 10.8" />
    <path d="M17.4 3c.44 1.95 1.2 2.71 3.15 3.15-1.95.44-2.71 1.2-3.15 3.15-.44-1.95-1.2-2.71-3.15-3.15C16.2 5.71 16.96 4.95 17.4 3Z" />
    <path d="M7.6 4.3c.23.98.62 1.37 1.6 1.6-.98.23-1.37.62-1.6 1.6-.23-.98-.62-1.37-1.6-1.6.98-.23 1.37-.62 1.6-1.6Z" />
  </>,
);

/** Brain — market intelligence and reasoning surfaces. */
export const Brain = createIcon(
  "brain",
  <>
    <path d="M12 6.1a3.2 3.2 0 0 0-5.7-1 2.8 2.8 0 0 0-1.4 4.6 2.9 2.9 0 0 0 .2 4.6 2.9 2.9 0 0 0 2.3 3.4A3.2 3.2 0 0 0 12 18.9Z" />
    <path d="M12 6.1a3.2 3.2 0 0 1 5.7-1 2.8 2.8 0 0 1 1.4 4.6 2.9 2.9 0 0 1-.2 4.6 2.9 2.9 0 0 1-2.3 3.4A3.2 3.2 0 0 1 12 18.9Z" />
    <path d="M9.6 9.5a2.1 2.1 0 0 0-2 1.9M14.4 9.5a2.1 2.1 0 0 1 2 1.9" />
  </>,
);

/** Bolt — speed, automation, instant actions. */
export const Bolt = createIcon(
  "bolt",
  <path d="M13.4 3 5.6 13.1a.5.5 0 0 0 .4.8h4.4l-.9 6.4a.3.3 0 0 0 .53.24l7.87-10.14a.5.5 0 0 0-.4-.8h-4.4l.9-6.4a.3.3 0 0 0-.53-.24Z" />,
);

/* ── Feedback: spinner, confirm, dismiss ──────────────────────────────── */

/**
 * Spinner. A single 270° arc rather than lucide's dashed circle, so the
 * rotation direction is unambiguous at small sizes. Animation comes from the
 * caller's `animate-spin`, which the icon opts into by default here because
 * a static spinner is always a bug.
 */
export const Spinner = createIcon(
  "spinner",
  <>
    <circle cx="12" cy="12" r="8.5" opacity="0.22" />
    <path d="M20.5 12A8.5 8.5 0 0 0 12 3.5" />
  </>,
);

export const Check = createIcon("check", <path d="M4.8 12.6 9.4 17 19.2 7" />);

export const CheckCircle = createIcon(
  "check-circle",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8.3 12.3l2.6 2.5 4.8-5" />
  </>,
);

export const X = createIcon(
  "x",
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </>,
);

export const XCircle = createIcon(
  "x-circle",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
  </>,
);

export const Plus = createIcon(
  "plus",
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const Minus = createIcon("minus", <path d="M5 12h14" />);

export const Info = createIcon(
  "info",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11.2v5" />
    <path d="M12 7.9h.01" />
  </>,
);

export const AlertCircle = createIcon(
  "alert-circle",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.8v4.8" />
    <path d="M12 16.1h.01" />
  </>,
);

export const AlertTriangle = createIcon(
  "alert-triangle",
  <>
    <path d="M10.7 4.3 3.3 17.1a1.5 1.5 0 0 0 1.3 2.3h14.8a1.5 1.5 0 0 0 1.3-2.3L13.3 4.3a1.5 1.5 0 0 0-2.6 0Z" />
    <path d="M12 9.4v3.7" />
    <path d="M12 16.4h.01" />
  </>,
);

/* ── Navigation ───────────────────────────────────────────────────────── */

export const ArrowRight = createIcon(
  "arrow-right",
  <>
    <path d="M4.6 12h14.8" />
    <path d="M13.4 6.2 19.4 12l-6 5.8" />
  </>,
);

export const ArrowLeft = createIcon(
  "arrow-left",
  <>
    <path d="M19.4 12H4.6" />
    <path d="M10.6 6.2 4.6 12l6 5.8" />
  </>,
);

export const ArrowUp = createIcon(
  "arrow-up",
  <>
    <path d="M12 19.4V4.6" />
    <path d="M6.2 10.6 12 4.6l5.8 6" />
  </>,
);

export const ArrowDown = createIcon(
  "arrow-down",
  <>
    <path d="M12 4.6v14.8" />
    <path d="M17.8 13.4 12 19.4l-5.8-6" />
  </>,
);

export const ArrowUpRight = createIcon(
  "arrow-up-right",
  <>
    <path d="M6.6 17.4 17.4 6.6" />
    <path d="M8.8 6.6h8.6v8.6" />
  </>,
);

export const ChevronDown = createIcon("chevron-down", <path d="M6.5 9.75 12 15.25l5.5-5.5" />);
export const ChevronUp = createIcon("chevron-up", <path d="M6.5 14.25 12 8.75l5.5 5.5" />);
export const ChevronLeft = createIcon("chevron-left", <path d="M14.25 6.5 8.75 12l5.5 5.5" />);
export const ChevronRight = createIcon("chevron-right", <path d="M9.75 6.5 15.25 12l-5.5 5.5" />);

export const ChevronsUpDown = createIcon(
  "chevrons-up-down",
  <>
    <path d="M7.5 9.6 12 5.1l4.5 4.5" />
    <path d="M16.5 14.4 12 18.9l-4.5-4.5" />
  </>,
);

export const MoreHorizontal = createIcon(
  "more-horizontal",
  <>
    <circle cx="5.4" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="18.6" cy="12" r="1.35" fill="currentColor" stroke="none" />
  </>,
);

export const MoreVertical = createIcon(
  "more-vertical",
  <>
    <circle cx="12" cy="5.4" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.6" r="1.35" fill="currentColor" stroke="none" />
  </>,
);

export const Menu = createIcon(
  "menu",
  <>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h11" />
  </>,
);

/* ── Actions ──────────────────────────────────────────────────────────── */

export const Send = createIcon(
  "send",
  <>
    <path d="M20.3 4 10.6 13.7" />
    <path d="M20.3 4 14.5 20.4a.4.4 0 0 1-.75.03l-3.15-6.73L3.87 10.4a.4.4 0 0 1 .03-.75Z" />
  </>,
);

export const Search = createIcon(
  "search",
  <>
    <circle cx="10.9" cy="10.9" r="6.4" />
    <path d="M15.6 15.6 20 20" />
  </>,
);

export const Copy = createIcon(
  "copy",
  <>
    <rect x="9" y="9" width="11" height="11" rx="2.6" />
    <path d="M15.4 5.6a2.6 2.6 0 0 0-2.4-1.6H6.6A2.6 2.6 0 0 0 4 6.6v6.4a2.6 2.6 0 0 0 1.6 2.4" />
  </>,
);

export const Trash = createIcon(
  "trash",
  <>
    <path d="M4.5 7.4h15" />
    <path d="M9.4 7.4V5.6a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v1.8" />
    <path d="M6.4 7.4l.75 11a1.4 1.4 0 0 0 1.4 1.3h6.9a1.4 1.4 0 0 0 1.4-1.3l.75-11" />
    <path d="M10.4 11v5M13.6 11v5" />
  </>,
);

export const Pencil = createIcon(
  "pencil",
  <>
    <path d="M16.1 4.6a1.9 1.9 0 0 1 2.7 0l.6.6a1.9 1.9 0 0 1 0 2.7L8.6 18.7l-4.1 1.1 1.1-4.1Z" />
    <path d="M14.6 6.1 17.9 9.4" />
  </>,
);

export const RefreshCw = createIcon(
  "refresh-cw",
  <>
    <path d="M19.6 11.2a7.7 7.7 0 0 0-13.2-4L4 9.6" />
    <path d="M4.4 12.8a7.7 7.7 0 0 0 13.2 4l2.4-2.4" />
    <path d="M4 5.4v4.2h4.2M20 18.6v-4.2h-4.2" />
  </>,
);

export const Upload = createIcon(
  "upload",
  <>
    <path d="M4.5 15.4v2.6a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-2.6" />
    <path d="M12 15.2V4.6" />
    <path d="M7.8 8.8 12 4.6l4.2 4.2" />
  </>,
);

export const Download = createIcon(
  "download",
  <>
    <path d="M4.5 15.4v2.6a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-2.6" />
    <path d="M12 4.6v10.6" />
    <path d="M7.8 11 12 15.2 16.2 11" />
  </>,
);

export const Share = createIcon(
  "share",
  <>
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M15.8 7.3 8.2 10.7M8.2 13.3l7.6 3.4" />
  </>,
);

export const Link = createIcon(
  "link",
  <>
    <path d="M10.2 13.8a3.6 3.6 0 0 1 0-5.1l2.6-2.6a3.6 3.6 0 0 1 5.1 5.1l-1.2 1.2" />
    <path d="M13.8 10.2a3.6 3.6 0 0 1 0 5.1l-2.6 2.6a3.6 3.6 0 0 1-5.1-5.1l1.2-1.2" />
  </>,
);

export const ExternalLink = createIcon(
  "external-link",
  <>
    <path d="M13.4 5.2h5.4v5.4" />
    <path d="M18.2 5.8 11 13" />
    <path d="M18.8 14.2v3.6a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8V7a1.8 1.8 0 0 1 1.8-1.8h3.6" />
  </>,
);

export const Filter = createIcon(
  "filter",
  <>
    <path d="M4.4 6.4h15.2" />
    <path d="M7 12h10" />
    <path d="M10 17.6h4" />
  </>,
);

export const Play = createIcon(
  "play",
  <path d="M8.4 5.6 18 11.5a.6.6 0 0 1 0 1L8.4 18.4a.6.6 0 0 1-.9-.5V6.1a.6.6 0 0 1 .9-.5Z" />,
  { solid: true },
);

export const Pause = createIcon(
  "pause",
  <>
    <rect x="7.4" y="5.4" width="3.6" height="13.2" rx="1.2" />
    <rect x="13" y="5.4" width="3.6" height="13.2" rx="1.2" />
  </>,
  { solid: true },
);

export const Stop = createIcon(
  "stop",
  <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.4" />,
  { solid: true },
);

/* ── Objects ──────────────────────────────────────────────────────────── */

export const Globe = createIcon(
  "globe",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.4 12h17.2" />
    <path d="M12 3.4c2.1 2.4 3.2 5.3 3.2 8.6S14.1 18.2 12 20.6C9.9 18.2 8.8 15.3 8.8 12S9.9 5.8 12 3.4Z" />
  </>,
);

export const Calendar = createIcon(
  "calendar",
  <>
    <rect x="3.9" y="5.6" width="16.2" height="14.2" rx="2.4" />
    <path d="M3.9 10h16.2" />
    <path d="M8.4 4.2v2.8M15.6 4.2v2.8" />
  </>,
);

export const Clock = createIcon(
  "clock",
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.6V12l3.1 1.9" />
  </>,
);

export const FileText = createIcon(
  "file-text",
  <>
    <path d="M13.6 3.9H7.4a2 2 0 0 0-2 2v12.2a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.9Z" />
    <path d="M13.6 3.9v5h5" />
    <path d="M8.8 12.6h6.4M8.8 15.8h4.4" />
  </>,
);

export const Image = createIcon(
  "image",
  <>
    <rect x="3.9" y="4.9" width="16.2" height="14.2" rx="2.4" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M4.2 17.2 8.6 13a1.6 1.6 0 0 1 2.2 0l5 4.8" />
    <path d="M14.4 15.1l1.4-1.3a1.6 1.6 0 0 1 2.2 0l1.8 1.7" />
  </>,
);

export const Eye = createIcon(
  "eye",
  <>
    <path d="M2.6 12S6.2 5.9 12 5.9 21.4 12 21.4 12 17.8 18.1 12 18.1 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </>,
);

export const Users = createIcon(
  "users",
  <>
    <circle cx="9.4" cy="8.4" r="3.4" />
    <path d="M3.4 19.6a6.2 6.2 0 0 1 12 0" />
    <path d="M16 5.4a3.4 3.4 0 0 1 0 6.6" />
    <path d="M17.6 13.8a6.2 6.2 0 0 1 3 5.8" />
  </>,
);

export const User = createIcon(
  "user",
  <>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M5.2 19.8a6.9 6.9 0 0 1 13.6 0" />
  </>,
);

export const Bell = createIcon(
  "bell",
  <>
    <path d="M18 15.6V11a6 6 0 1 0-12 0v4.6L4.6 18h14.8Z" />
    <path d="M10.2 18a1.9 1.9 0 0 0 3.6 0" />
  </>,
);

export const Lock = createIcon(
  "lock",
  <>
    <rect x="4.9" y="10.4" width="14.2" height="9.4" rx="2.4" />
    <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
  </>,
);

export const BarChart = createIcon(
  "bar-chart",
  <>
    <path d="M4.4 19.6h15.2" />
    <path d="M7.6 19.6v-6.2M12 19.6V7.4M16.4 19.6v-9" />
  </>,
);

export const TrendingUp = createIcon(
  "trending-up",
  <>
    <path d="M3.8 16.6 9.4 11l3.4 3.4 7.4-7.4" />
    <path d="M15.2 7h5v5" />
  </>,
);

export const Lightbulb = createIcon(
  "lightbulb",
  <>
    <path d="M9.2 16.4a6 6 0 1 1 5.6 0v1.6a1.4 1.4 0 0 1-1.4 1.4h-2.8a1.4 1.4 0 0 1-1.4-1.4Z" />
    <path d="M9.8 19.8h4.4" />
  </>,
);

export const Target = createIcon(
  "target",
  <>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="4.6" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>,
);

export const Sun = createIcon(
  "sun",
  <>
    <circle cx="12" cy="12" r="4.1" />
    <path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
  </>,
);

export const Moon = createIcon(
  "moon",
  <path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z" />,
);

export const MessageSquare = createIcon(
  "message-square",
  <path d="M20 14.4a2.4 2.4 0 0 1-2.4 2.4H8.8L4 20.2V6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4Z" />,
);

export const Layers = createIcon(
  "layers",
  <>
    <path d="M11.3 3.7 3.8 7.4a.8.8 0 0 0 0 1.4l7.5 3.7a1.6 1.6 0 0 0 1.4 0l7.5-3.7a.8.8 0 0 0 0-1.4l-7.5-3.7a1.6 1.6 0 0 0-1.4 0Z" />
    <path d="M3.6 12.6l7.7 3.8a1.6 1.6 0 0 0 1.4 0l7.7-3.8" />
    <path d="M3.6 16.6l7.7 3.8a1.6 1.6 0 0 0 1.4 0l7.7-3.8" />
  </>,
);

/** A live/active indicator. Solid so it reads at 6–8px. */
export const Dot = createIcon("dot", <circle cx="12" cy="12" r="4.4" />, { solid: true });

export const Circle = createIcon("circle", <circle cx="12" cy="12" r="8.6" />);
