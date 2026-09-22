"use client";
// BrandDnaCompetitorsCallout.tsx — the bridge from Brand DNA's competitor list
// to the researched one.
//
// Brand DNA's own list is a memory: names and URLs a person typed, which feed
// every prompt. The Competitors surface is research: what those companies
// actually do and what changed. They are the same companies, so this joins
// them — anything typed here is lifted into the tracked set the first time
// discovery runs, and this callout is how the user gets there.
import * as React from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { workspacePath } from "@/lib/workspace/paths";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { ArrowRight, Search, Spinner } from "@/components/icons";
import { useCompetitorOverview, useDiscoverCompetitors } from "./hooks";

export function BrandDnaCompetitorsCallout() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();
  const overview = useCompetitorOverview(workspaceId);
  const discover = useDiscoverCompetitors(workspaceId);

  if (!workspaceId) return null;

  const tracked = overview.data?.competitors.length ?? 0;
  const suggested = overview.data?.suggestions.length ?? 0;
  const researchAvailable = overview.data?.researchAvailable ?? false;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/40 px-3.5 py-2.5">
      <p className="min-w-0 text-[12.5px] leading-relaxed text-muted-foreground">
        {tracked > 0
          ? `We're watching ${tracked} competitor${tracked === 1 ? "" : "s"}${
              suggested > 0 ? `, with ${suggested} more suggested` : ""
            }.`
          : "We can find who you're up against and keep track of what they change."}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {tracked === 0 && researchAvailable && (
          <button
            type="button"
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 text-[12px] font-medium",
              "transition-colors hover:border-foreground/20 hover:bg-secondary disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {discover.isPending ? (
              <Spinner className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            Find them
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(workspacePath(workspaceId, "competitors"))}
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
        >
          Open Competitors
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
