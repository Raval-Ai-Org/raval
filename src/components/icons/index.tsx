"use client";

import type * as React from "react";

/**
 * The single icon source for the app.
 *
 * Three tiers, in order of preference:
 *
 *   1. Mellox glyphs (`./glyphs`) — the bespoke set. The AI mark, the spinner,
 *      confirm/dismiss, arrows, and the everyday objects. These define how the
 *      product feels, so they are drawn rather than borrowed.
 *   2. Platform marks (`./social`) — real brand logos, never approximations.
 *   3. lucide-react — the long tail. Same construction principles (24px grid,
 *      stroked, round caps), so it sits beside the bespoke set without
 *      looking like a different family.
 *
 * Import everything from here. The aliases below exist so the ~180 names the
 * previous Material-Symbols module exported keep resolving, which is what let
 * the font be removed in one change instead of fifty.
 */

import {
  Activity,
  BookOpen,
  Bookmark,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Camera,
  CheckSquare,
  CircleDot,
  Cloud,
  Code,
  Coffee,
  Command,
  Compass,
  CornerDownLeft,
  Cpu,
  Crown,
  Database,
  EyeOff,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileType2,
  Folder,
  Gauge,
  Gift,
  GitCommit,
  Github,
  GripVertical,
  Heart,
  HelpCircle,
  History,
  Home,
  ImagePlus,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LineChart,
  List,
  ListChecks,
  ListTodo,
  ListTree,
  LogIn,
  LogOut,
  Mail,
  Megaphone,
  MessageCircle,
  Mic,
  MicOff,
  MousePointerClick,
  Music2,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PenLine,
  PenTool,
  PieChart,
  Pin,
  Plug,
  Power,
  Radio,
  Repeat,
  Repeat2,
  Rocket,
  RotateCcw,
  Rows2,
  Rows3,
  Save,
  ScanLine,
  Settings,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SkipForward,
  SlidersHorizontal,
  SortAsc,
  Square,
  Star,
  StickyNote,
  Swords,
  Tag,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  Trophy,
  Type,
  Unlock,
  UserCircle2,
  UserPlus,
  Video,
  Wallet,
  Wifi,
  WifiOff,
  Workflow,
  Wrench,
  ZapOff,
} from "lucide-react";

export * from "./glyphs";
export * from "./social";
export { type IconProps, ICON_STROKE, createIcon } from "./icon-base";

import {
  ArrowDown,
  ArrowUp,
  BarChart,
  Bolt,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image,
  Link,
  Pencil,
  RefreshCw,
  Share,
  Spinner,
  Stop,
  Trash,
  Wand,
} from "./glyphs";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedinIcon,
  ThreadsIcon,
  TiktokIcon,
  XIcon,
  YoutubeIcon,
} from "./social";

export {
  Activity,
  BookOpen,
  Bookmark,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Camera,
  CheckSquare,
  CircleDot,
  Cloud,
  Code,
  Coffee,
  Command,
  Compass,
  CornerDownLeft,
  Cpu,
  Crown,
  Database,
  EyeOff,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileType2,
  Folder,
  Gauge,
  Gift,
  GitCommit,
  Github,
  GripVertical,
  Heart,
  HelpCircle,
  History,
  Home,
  ImagePlus,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LineChart,
  List,
  ListChecks,
  ListTodo,
  ListTree,
  LogIn,
  LogOut,
  Mail,
  Megaphone,
  MessageCircle,
  Mic,
  MicOff,
  MousePointerClick,
  Music2,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  PenLine,
  PenTool,
  PieChart,
  Pin,
  Plug,
  Power,
  Radio,
  Repeat,
  Repeat2,
  Rocket,
  RotateCcw,
  Rows2,
  Rows3,
  Save,
  ScanLine,
  Settings,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SkipForward,
  SlidersHorizontal,
  SortAsc,
  Square,
  Star,
  StickyNote,
  Swords,
  Tag,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  Trophy,
  Type,
  Unlock,
  UserCircle2,
  UserPlus,
  Video,
  Wallet,
  Wifi,
  WifiOff,
  Workflow,
  Wrench,
  ZapOff,
};

/* ── Aliases ──────────────────────────────────────────────────────────────
   Names the rest of the app already imports, pointed at the right glyph.   */

/** Spinner is a 270° arc — unambiguous direction at small sizes. */
export { Spinner as Loader2 };
export { Bolt as Zap };
export { Wand as Wand2 };
export { BarChart as BarChart3 };
export { CheckCircle as CheckCircle2 };
export { Share as Share2 };
export { Trash as Trash2 };
export { Link as Link2 };
export { Image as ImageIcon };
export { Calendar as CalendarIcon };
export { ChevronDown as ChevronDownIcon };
export { ChevronLeft as ChevronLeftIcon };
export { ChevronRight as ChevronRightIcon };
export { RefreshCw as RefreshCcw };
export { Pencil as Edit, Pencil as Edit2 };
export { PenLine as Edit3 };
export { ArrowUp as ArrowUpIcon, ArrowDown as ArrowDownIcon };
export { Stop as StopIcon };
export { Spinner as LoaderIcon };
export { PanelLeftOpen as SidebarOpen, PanelLeftClose as SidebarClose };

/* Platform marks under the names the app uses. `Twitter` resolves to X's
   current mark, not the retired bird. */
export { XIcon as Twitter };
export { LinkedinIcon as Linkedin };
export { InstagramIcon as Instagram };
export { FacebookIcon as Facebook };
export { ThreadsIcon as Threads };
export { TiktokIcon as Tiktok };
export { YoutubeIcon as Youtube };

/**
 * The component shape every icon in this module satisfies. Named `LucideIcon`
 * because that is what call sites and `PlatformSpec` already type against.
 *
 * Deliberately permissive: this module mixes forwardRef components (the
 * bespoke glyphs), lucide's own exotic components, and the BrandLogo adapters,
 * and several call sites declare narrower local prop types for the icon they
 * accept. Pinning the props here makes those assignments fail on `defaultProps`
 * variance without catching any real mistake.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type LucideIcon = React.ComponentType<any>;
