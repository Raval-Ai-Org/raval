"use client";

/**
 * Social platform marks, as icon components.
 *
 * The real brand paths live in `@/components/brand/BrandLogo` — this file just
 * adapts them to the icon component shape (`{ className, size, ... }`) so
 * anywhere that wants "the LinkedIn icon" gets LinkedIn's actual logo.
 *
 * It exists because the old icon module mapped platforms to whatever generic
 * Material glyph was nearest: LinkedIn was `group` (two anonymous silhouettes),
 * Instagram was `photo_camera`, X was `alternate_email` (an @ sign), YouTube
 * was `smart_display`, TikTok was `music_note`, and Threads was `chat_bubble`.
 * Those were rendered by `src/lib/social-platforms.ts` — the canonical platform
 * registry — while other components drew the correct logos, so the same
 * platform appeared two different ways in one product.
 */

import * as React from "react";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import type { IconProps } from "./icon-base";

function brandIcon(name: BrandKey, label: string) {
  const Component = React.forwardRef<SVGSVGElement, IconProps>(function BrandIcon(
    { className, size = 20, ...rest },
    _ref,
  ) {
    // `brand` is intentionally off: marks inherit currentColor so they sit in
    // whatever context they are placed in. Pass `brand` at the BrandLogo call
    // site when the official colour is wanted (a connect button, say).
    return (
      <BrandLogo
        name={name}
        size={typeof size === "string" ? Number.parseFloat(size) : size}
        className={className}
        aria-label={rest["aria-label"] ?? undefined}
      />
    );
  });
  Component.displayName = `BrandIcon(${label})`;
  return Component;
}

export const LinkedinIcon = brandIcon("linkedin", "LinkedIn");
export const XIcon = brandIcon("x", "X");
export const InstagramIcon = brandIcon("instagram", "Instagram");
export const FacebookIcon = brandIcon("facebook", "Facebook");
export const ThreadsIcon = brandIcon("threads", "Threads");
export const TiktokIcon = brandIcon("tiktok", "TikTok");
export const YoutubeIcon = brandIcon("youtube", "YouTube");
export const RedditIcon = brandIcon("reddit", "Reddit");
export const PinterestIcon = brandIcon("pinterest", "Pinterest");
export const MetaIcon = brandIcon("meta", "Meta");
export const GoogleIcon = brandIcon("google", "Google");
export const OpenaiIcon = brandIcon("openai", "OpenAI");
export const ClaudeIcon = brandIcon("claude", "Claude");
export const GeminiIcon = brandIcon("gemini", "Gemini");
