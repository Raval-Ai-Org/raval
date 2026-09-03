"use client";

/**
 * Raval brand icon barrel — Gemini phase.
 *
 * Previously custom Raval SVGs. Now every icon here re-exports the equivalent
 * Google Material Symbols Rounded glyph — the icon family used across Google
 * Gemini — via the `<Mi>`-powered adapters in `./gemini-icons.tsx`.
 *
 * Consumers keep the same import surface, so app.tsx / TopBarActions /
 * StudioRail / StudioCanvasModal / CommandBar / ChatPanel automatically pick
 * up Gemini icons with zero JSX changes. Colour follows currentColor, so the
 * theme drives black (light) / white (dark).
 */
import * as React from "react";
import * as G from "@/components/ui/gemini-icons";

export type IconProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: number;
  strokeWidth?: number; // accepted for API parity with Lucide; ignored
  className?: string;
};

/** Loose type so both Gemini adapters and legacy Lucide components satisfy it. */
export type BrandIcon = React.ComponentType<any>;
export type LucideIcon = BrandIcon;

export const X = G.X;
export const Radio = G.Radio;

/* ── Navigation / chrome ────────────────────────────────────── */
export const ArrowLeft = G.ArrowLeft;
export const ArrowRight = G.ArrowRight;
export const ArrowUp = G.ArrowUp;
export const ChevronDown = G.ChevronDown;
export const ChevronRight = G.ChevronRight;
export const CornerDownLeft = G.ArrowDown; // closest Material rounded glyph
export const Menu = G.Menu;
export const Search = G.Search;
export const Settings = G.Settings;
export const Sun = G.Sun;
export const Moon = G.Moon;
export const PanelRightOpen = G.PanelRightOpen;
export const PanelRightClose = G.PanelLeftOpen;
export const Plus = G.Plus;
export const Check = G.Check;
export const Square = G.Square;
export const Play = G.Play;
export const Pause = G.Pause;
export const Power = G.LogOut;
export const LogOut = G.LogOut;

/* ── Product / feature ──────────────────────────────────────── */
export const Sparkles = G.Sparkles;
export const Brain = G.Brain;
export const Bot = G.Bot;
export const Wand2 = G.Wand2;
export const Rocket = G.Rocket;
export const BarChart3 = G.BarChart3;
export const Calendar = G.CalendarIcon;
export const MessageSquare = G.MessageSquare;
export const Share2 = G.Share2;
export const Target = G.Target;
export const Globe = G.Globe;
export const FileText = G.FileText;
export const Paperclip = G.Paperclip;
export const Zap = G.Zap;
export const SlidersHorizontal = G.SlidersHorizontal;
export const Command = G.Command;
export const AlertTriangle = G.AlertTriangle;
export const Info = G.Info;
export const HelpCircle = G.HelpCircle;
export const CheckSquare = G.Check;
export const Users = G.Users;
export const Mail = G.Mail;
export const Send = G.Send;
export const Image = G.Image;
export const Pencil = G.Edit;
export const Trash2 = G.Trash2;
export const History = G.RefreshCw;
export const Repeat = G.RefreshCw;
export const Palette = G.Sparkles;
export const LayoutGrid = G.Folder;
export const Megaphone = G.Bell;
export const Gift = G.Star;
export const Wallet = G.Cloud;
export const Crown = G.Star;
export const Plug = G.Link;
