"use client";

/**
 * Gemini-style icon adapters.
 *
 * Each export mirrors the API of the equivalent `lucide-react` component
 * (accepts `className`, `aria-hidden`, `style`, etc.) but renders the
 * authentic Google Material Symbols Rounded glyph — the icon family used
 * throughout Google Gemini's UI. Colour follows `currentColor` so the
 * theme (light/dark) drives black/white automatically.
 *
 * Usage — swap the import source, keep the JSX:
 *
 *   // before
 *   import { Settings, Sun, Moon } from "lucide-react";
 *
 *   // after
 *   import { Settings, Sun, Moon } from "@/components/ui/gemini-icons";
 *
 * Sizing: honours Tailwind h-* / w-* utility classes (h-3 → 12px,
 * h-3.5 → 14px, h-4 → 16px, h-5 → 20px, h-6 → 24px). Falls back to 20px.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// Permissive Lucide-compatible props. Accepts SVG-typed handlers (onCopy,
// onClick), stroke/fill, size, strokeWidth, etc. We drop props that don't
// apply to the underlying <span> — this keeps call-site parity with Lucide.
type IconProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "onCopy" | "onCut" | "onPaste"> & {
  className?: string;
  strokeWidth?: number | string;
  size?: number | string;
  fill?: string;
  stroke?: string;
  color?: string;
  onCopy?: unknown;
  onCut?: unknown;
  onPaste?: unknown;
};

// Normalized icon scale — matches ChatGPT rhythm and the button system:
//   xs = 16px  (dense inline chips, meta rows, small buttons)
//   sm = 18px  (default — buttons, list rows, inputs)
//   md = 20px  (section headers, toolbar actions, large buttons)
//   lg = 24px  (hero, empty state, feature tiles)
const ICON_XS = 16;
const ICON_SM = 18;
const ICON_MD = 20;
const ICON_LG = 24;
const ICON_DEFAULT = ICON_SM;

const SIZE_MAP: Record<string, number> = {
  // xs bucket (16px)
  "h-2": ICON_XS,
  "h-2.5": ICON_XS,
  "h-3": ICON_XS,
  "h-3.5": ICON_XS,
  "h-4": ICON_XS,
  // sm bucket — default (18px)
  "h-4.5": ICON_SM,
  // md bucket (20px)
  "h-5": ICON_MD,
  "h-6": ICON_MD,
  // lg bucket (24px)
  "h-7": ICON_LG,
  "h-8": ICON_LG,
  "h-9": ICON_LG,
  "h-10": ICON_LG,
  // oversized (empty states / illustrations) keep their footprint
  "h-11": 28,
  "h-12": 32,
  "h-14": 36,
  "h-16": 40,
  "h-20": 48,
};

function pickSize(className?: string, size?: number | string): number {
  const n = typeof size === "string" ? Number(size) : size;
  if (typeof n === "number" && !Number.isNaN(n)) {
    // Snap explicit pixel sizes to the nearest bucket.
    if (n <= 14) return ICON_XS;
    if (n <= 17) return ICON_SM;
    if (n <= 22) return ICON_MD;
    if (n <= 28) return ICON_LG;
    return n;
  }
  if (!className) return ICON_DEFAULT;
  for (const cls of className.split(/\s+/)) {
    if (SIZE_MAP[cls] !== undefined) return SIZE_MAP[cls];
    const m = cls.match(/^h-\[(\d+)px\]$/);
    if (m) return pickSize(undefined, Number(m[1]));
  }
  return ICON_DEFAULT;
}

// Ligature-resolution cache. Once we've probed a glyph name and confirmed it
// renders as a real icon (or falls back to text), reuse that decision so
// every subsequent icon of the same name skips the measurement round-trip.
// true = valid ligature, false = falls back to the default glyph.
const LIGATURE_CACHE = new Map<string, boolean>();
const FALLBACK_GLYPH = "circle"; // simple monochrome dot — always present

function make(
  name: string,
  opts: { filled?: boolean; weight?: "regular" | "medium" | "bold" } = {},
) {
  const Component = React.forwardRef<HTMLSpanElement, IconProps>(function GeminiIcon(props, ref) {
    const {
      className,
      style,
      size,
      strokeWidth: _sw,
      fill,
      stroke: _stroke,
      color,
      onCopy: _oc,
      onCut: _ocu,
      onPaste: _op,
      ...rest
    } = props;
    const px = pickSize(className, size);
    const spanProps = rest as unknown as React.HTMLAttributes<HTMLSpanElement>;
    // `fill` maps to CSS `color` (the Material Symbols glyph is `currentColor`).
    // Ignore `fill="none"` — that's a Lucide-only stroke hint.
    const tint = color ?? (fill && fill !== "none" ? fill : undefined);
    // A caller passing a real fill colour usually wants the solid variant.
    const filled = opts.filled || (fill !== undefined && fill !== "none");

    const cached = LIGATURE_CACHE.get(name);
    const [glyph, setGlyph] = React.useState<string>(cached === false ? FALLBACK_GLYPH : name);
    const innerRef = React.useRef<HTMLSpanElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLSpanElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLSpanElement | null>).current = node;
      },
      [ref],
    );

    React.useEffect(() => {
      if (cached !== undefined) return; // already decided
      const el = innerRef.current;
      if (!el || typeof document === "undefined") return;

      const check = () => {
        const el2 = innerRef.current;
        if (!el2) return;
        // A resolved ligature renders as a single-glyph square (~1em wide).
        // Raw text like "magic_button" measures much wider than the font-size.
        const wide = el2.scrollWidth > px * 1.4;
        const resolved = !wide;
        LIGATURE_CACHE.set(name, resolved);
        if (!resolved) setGlyph(FALLBACK_GLYPH);
      };

      const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fonts?.ready) {
        fonts.ready.then(check).catch(check);
      } else {
        // Fallback: give the browser a tick to paint.
        const t = window.setTimeout(check, 100);
        return () => window.clearTimeout(t);
      }
    }, [cached, px]);

    return (
      <span
        ref={setRefs}
        aria-hidden={props["aria-label"] ? undefined : true}
        data-filled={filled ? "true" : undefined}
        data-weight={opts.weight}
        data-icon={name}
        className={cn("mi shrink-0", className)}
        style={{
          fontSize: `${px}px`,
          width: `${px}px`,
          height: `${px}px`,
          lineHeight: `${px}px`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          color: tint,
          ...style,
        }}
        {...spanProps}
      >
        {glyph}
      </span>
    );
  });
  Component.displayName = `GeminiIcon(${name})`;
  return Component;
}

/* ── Common chrome / navigation ─────────────────────────────── */
export const ArrowLeft = make("arrow_back");
export const ArrowRight = make("arrow_forward");
export const ArrowUp = make("arrow_upward");
export const ArrowDown = make("arrow_downward");
export const ArrowUpRight = make("north_east");
export const ChevronDown = make("keyboard_arrow_down");
export const ChevronUp = make("keyboard_arrow_up");
export const ChevronLeft = make("keyboard_arrow_left");
export const ChevronRight = make("keyboard_arrow_right");
export const X = make("close");
export const Check = make("check", { weight: "medium" });
export const Plus = make("add", { weight: "medium" });
export const Minus = make("remove");
export const MoreHorizontal = make("more_horiz");
export const MoreVertical = make("more_vert");
export const Menu = make("menu");
export const Search = make("search");
export const Settings = make("settings", { filled: false });
export const Sun = make("light_mode", { filled: false });
export const Moon = make("dark_mode", { filled: true });
export const Bell = make("notifications", { filled: false });
export const User = make("person", { filled: false });
export const Users = make("group", { filled: false });
export const LogOut = make("logout");
export const LogIn = make("login");
export const PanelRightOpen = make("right_panel_open");
export const PanelLeftOpen = make("left_panel_open");
export const SidebarClose = make("left_panel_close");
export const SidebarOpen = make("left_panel_open");
export const Loader2 = make("progress_activity");
export const Square = make("stop", { filled: true });

/* ── Product / feature ──────────────────────────────────────── */
export const Sparkles = make("auto_awesome");
export const Brain = make("neurology");
export const Bot = make("smart_toy", { filled: false });
export const Wand2 = make("magic_button");
export const Radio = make("podcasts");
export const Rocket = make("rocket_launch");
export const BarChart3 = make("bar_chart");
export const LineChart = make("show_chart");
export const PieChart = make("pie_chart");
export const TrendingUp = make("trending_up");
export const CalendarIcon = make("calendar_today");
export const CalendarDays = make("calendar_month");
export const Share2 = make("share");
export const Target = make("target");
export const Globe = make("public");
export const MessageSquare = make("chat_bubble", { filled: false });
export const BookOpen = make("menu_book");
export const FileText = make("description");
export const FileSpreadsheet = make("table_chart");
export const FileImage = make("image");
export const File = make("draft");
export const Paperclip = make("attach_file");
export const Zap = make("bolt", { filled: true });
export const ZapOff = make("flash_off");
export const Rows3 = make("view_agenda");
export const Rows2 = make("splitscreen");
export const SlidersHorizontal = make("tune");
export const Command = make("keyboard_command_key");
export const CheckCircle2 = make("check_circle", { filled: true });
export const AlertTriangle = make("warning", { filled: true });
export const Info = make("info", { filled: false });
export const HelpCircle = make("help", { filled: false });
export const Edit = make("edit");
export const Edit2 = make("edit");
export const Edit3 = make("edit_note");
export const Trash = make("delete");
export const Trash2 = make("delete");
export const Copy = make("content_copy");
export const Download = make("download");
export const Upload = make("upload");
export const ExternalLink = make("open_in_new");
export const Link = make("link");
export const Eye = make("visibility");
export const EyeOff = make("visibility_off");
export const Lock = make("lock", { filled: true });
export const Unlock = make("lock_open");
export const Home = make("home", { filled: false });
export const Folder = make("folder", { filled: false });
export const Star = make("star", { filled: false });
export const Heart = make("favorite", { filled: false });
export const Play = make("play_arrow", { filled: true });
export const Pause = make("pause", { filled: true });
export const Stop = make("stop", { filled: true });
export const RefreshCw = make("refresh");
export const Filter = make("filter_list");
export const SortAsc = make("sort");
export const Mail = make("mail", { filled: false });
export const Send = make("send", { filled: true });
export const Image = make("image", { filled: false });
export const Camera = make("photo_camera", { filled: false });
export const Mic = make("mic", { filled: true });
export const MicOff = make("mic_off");
export const Video = make("videocam", { filled: true });
export const Code = make("code");
export const Terminal = make("terminal");
export const Database = make("database");
export const Cloud = make("cloud", { filled: true });

/* ── Extended coverage (Lucide parity) ──────────────────────── */
export const Activity = make("monitoring");
export const AlertCircle = make("error", { filled: false });
export const Bookmark = make("bookmark", { filled: false });
export const Building2 = make("apartment");
export const Calendar = make("calendar_today");
export const CalendarClock = make("event_upcoming");
export const CalendarRange = make("date_range");
export const CheckSquare = make("check_box", { filled: true });
export const ChevronDownIcon = make("keyboard_arrow_down");
export const ChevronLeftIcon = make("keyboard_arrow_left");
export const ChevronRightIcon = make("keyboard_arrow_right");
export const ChevronsUpDown = make("unfold_more");
export const Circle = make("circle", { filled: false });
export const CircleDot = make("radio_button_checked");
export const Clock = make("schedule");
export const Coffee = make("coffee");
export const Compass = make("explore");
export const Cpu = make("memory");
export const Crown = make("workspace_premium", { filled: true });
export const Facebook = make("facebook");
export const FileCode2 = make("code_blocks");
export const FileType2 = make("description");
export const Gauge = make("speed");
export const GitCommit = make("commit");
export const Github = make("code");
export const GripVertical = make("drag_indicator");
export const History = make("history");
export const ImageIcon = make("image", { filled: false });
export const ImagePlus = make("add_photo_alternate");
export const Inbox = make("inbox");
export const Instagram = make("photo_camera");
export const KeyRound = make("key", { filled: true });
export const Layers = make("layers");
export const LayoutDashboard = make("dashboard", { filled: false });
export const LayoutGrid = make("grid_view");
export const LayoutTemplate = make("dashboard_customize");
export const Lightbulb = make("lightbulb", { filled: false });
export const Link2 = make("link");
export const Linkedin = make("group");
export const ListChecks = make("checklist");
export const ListTodo = make("checklist_rtl");
export const ListTree = make("account_tree");
export const Megaphone = make("campaign", { filled: true });
export const MessageCircle = make("chat_bubble", { filled: false });
export const MousePointerClick = make("ads_click");
export const Music2 = make("music_note");
export const Palette = make("palette", { filled: false });
export const PanelLeft = make("left_panel_open");
export const PenLine = make("edit_note");
export const PenTool = make("edit");
export const Pencil = make("edit");
export const Plug = make("power");
export const Power = make("power_settings_new");
export const RefreshCcw = make("refresh");
export const Repeat2 = make("repeat");
export const RotateCcw = make("restart_alt");
export const Save = make("save", { filled: false });
export const ScanLine = make("document_scanner");
export const Settings2 = make("tune");
export const Shield = make("shield", { filled: false });
export const ShieldCheck = make("verified_user", { filled: true });
export const ShoppingBag = make("shopping_bag", { filled: false });
export const SkipForward = make("skip_next", { filled: true });
export const Swords = make("swords");
export const Tag = make("sell", { filled: false });
export const ThumbsDown = make("thumb_down", { filled: false });
export const ThumbsUp = make("thumb_up", { filled: false });
export const TrendingDown = make("trending_down");
export const Trophy = make("trophy", { filled: true });
export const Twitter = make("alternate_email");
export const Type = make("title");
export const UserCircle2 = make("account_circle", { filled: false });
export const UserPlus = make("person_add");
export const Wifi = make("wifi");
export const WifiOff = make("wifi_off");
export const Workflow = make("account_tree");
export const Wrench = make("build");
export const XCircle = make("cancel", { filled: true });
export const Youtube = make("smart_display", { filled: true });
export const Pin = make("push_pin", { filled: false });
export const StickyNote = make("sticky_note_2", { filled: false });

/* ── Type alias parity ──────────────────────────────────────── */
export type LucideIcon = React.ForwardRefExoticComponent<
  IconProps & React.RefAttributes<HTMLSpanElement>
>;
