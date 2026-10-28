"use client";

import type { ReactNode, Ref } from "react";
import { ArrowLeft, ArrowRight, Plug } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

/**
 * Connecting accounts is optional: Mellox drafts either way, and a connected
 * account is what lets an approved post go out and its results come back.
 * The tiles themselves are `SocialAccountsSection` (variant "onboarding").
 */
export function ChannelsStep({
  connectedCount,
  headingRef,
  children,
  onBack,
  onContinue,
}: {
  connectedCount: number;
  headingRef: Ref<HTMLHeadingElement>;
  children: ReactNode;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <Eyebrow icon={Plug}>Channels</Eyebrow>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        Where should your posts go?
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Connect the accounts you post on. Mellox only publishes what you approve, and it reads each
        post&rsquo;s results so it can learn what works for you.
      </p>

      <div className="mt-8">{children}</div>

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className={cn(connectedCount ? dsPrimaryBtn : dsGhostBtn, "h-12 px-6 text-[14.5px]")}
        >
          {connectedCount ? "Continue" : "Skip for now"}{" "}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
