import type { PlatformId } from "./social-platforms";
import type { ImgSize } from "./post-image";

export type CreativeBrief = {
  objective: "awareness" | "consideration" | "conversion" | "retention";
  funnel: "top" | "middle" | "bottom" | "post-purchase";
  audience: string;
  creativeAngle: string;
  platformRole: string;
  qaRules: string[];
};

export function deriveCreativeBrief(args: {
  body: string;
  audience?: string | null;
  platform?: PlatformId | null;
  size: ImgSize;
}): CreativeBrief {
  const text = args.body.toLowerCase();
  const conversion = /(buy|book|demo|trial|pricing|offer|sale|shop|sign up|apply)/.test(text);
  const consideration = /(how|why|compare|guide|learn|proof|case study|mistake)/.test(text);
  const retention = /(customer|community|thank|already|member|behind the scenes)/.test(text);
  const objective = conversion
    ? "conversion"
    : retention
      ? "retention"
      : consideration
        ? "consideration"
        : "awareness";
  const funnel = conversion
    ? "bottom"
    : retention
      ? "post-purchase"
      : consideration
        ? "middle"
        : "top";
  const platformRole = args.platform
    ? `${args.platform} native creative: respect its feed behavior, viewing distance, and content culture`
    : "social-first creative: earn attention quickly without looking like an ad template";
  const creativeAngle = conversion
    ? "make the value and desired next step feel tangible without relying on baked-in CTA text"
    : consideration
      ? "turn the insight into a memorable visual metaphor with credible, specific detail"
      : retention
        ? "make the audience feel recognized and part of the brand world"
        : "create an immediate pattern break that communicates the brand promise at a glance";
  const qaRules = [
    "No invented claims, prices, URLs, legal copy, or critical text in the image.",
    "Keep the focal subject and any optional short hook inside the requested safe area.",
    "Check that the composition remains legible at thumbnail size and survives platform cropping.",
  ];
  if (args.size === "1024x1792")
    qaRules.push("Reserve the top and bottom UI-chrome zones for platform controls.");
  return {
    objective,
    funnel,
    audience: args.audience?.trim() || "the brand's intended audience",
    creativeAngle,
    platformRole,
    qaRules,
  };
}

export function validateCreativeBrief(brief: CreativeBrief): string[] {
  return brief.qaRules.filter(Boolean);
}
