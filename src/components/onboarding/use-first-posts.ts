"use client";

// The three first posts at the end of onboarding. Each is an ordinary Studio
// job through POST /api/studio/jobs (the metered path every post takes),
// created only when the person clicks, with a fixed key per post so a double
// click or a refresh never makes or charges a post twice.
import { useEffect, useMemo, useRef, useState } from "react";
import { creditsFor } from "@/lib/billing/catalog";
import type { FirstPostBrief } from "@/lib/onboarding/flow";
import { studioChargeFor } from "@/lib/studio/billing";
import { StudioApiError, readBrandPayload, studioApi } from "@/lib/studio/client";
import { isActiveJob, type CreateJobInput, type StudioJob } from "@/lib/studio/jobs";
import type { FirstPostState } from "./FirstWinStep";

const POLL_MS = 3_000;

const fromJob = (job: StudioJob): FirstPostState =>
  isActiveJob(job)
    ? { status: "running", job }
    : job.status === "succeeded"
      ? { status: "succeeded", job }
      : {
          status: "failed",
          job,
          error: job.error?.message || "This post didn't finish. Try again.",
        };

export function useFirstPosts(workspaceId: string | null, briefs: FirstPostBrief[]) {
  const [posts, setPosts] = useState<Record<number, FirstPostState>>({});
  const [billing, setBilling] = useState<{ message: string; href: string } | null>(null);
  const attempts = useRef<Record<number, number>>({});
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const priceLabel = useMemo(() => {
    const total = briefs.reduce((sum, b) => {
      const charge = studioChargeFor({
        type: b.job.type,
        includeImage: b.job.controls.includeImage,
        referenceMode: b.job.controls.referenceMode,
        referenceAssetIds: b.job.controls.referenceAssetIds,
      });
      // Social posts never take the video meter.
      return charge === "studio_video" || charge === "studio_short_clip"
        ? sum
        : sum + creditsFor(charge);
    }, 0);
    return `${total} credits`;
  }, [briefs]);

  const set = (n: number, state: FirstPostState) =>
    live.current && setPosts((p) => ({ ...p, [n]: state }));

  const follow = async (n: number, job: StudioJob) => {
    let current = job;
    set(n, fromJob(current));
    while (live.current && isActiveJob(current) && workspaceId) {
      await new Promise((r) => window.setTimeout(r, POLL_MS));
      try {
        current = await studioApi.getJob(workspaceId, current.id);
        set(n, fromJob(current));
      } catch {
        /* a missed poll is retried on the next tick */
      }
    }
  };

  const create = async (brief: FirstPostBrief, attempt: number): Promise<boolean> => {
    if (!workspaceId) return false;
    set(brief.n, { status: "starting" });
    const key = attempt ? `${brief.job.idempotencyKey}:${attempt}` : brief.job.idempotencyKey;
    try {
      const job = await studioApi.createJob({
        ...brief.job,
        idempotencyKey: key,
        brand: readBrandPayload(workspaceId),
      } as CreateJobInput);
      void follow(brief.n, job);
      return true;
    } catch (error) {
      if (error instanceof StudioApiError && error.status === 402) {
        setBilling({
          message:
            "Your plan has run out of credits for new posts. You can finish setup and add more later.",
          href: "/pricing",
        });
        set(brief.n, { status: "idle" });
        return false;
      }
      set(brief.n, {
        status: "failed",
        error: error instanceof Error ? error.message : "This post didn't start. Try again.",
      });
      return true;
    }
  };

  // A refresh on this step picks up posts that were already started.
  const keys = briefs.map((b) => b.job.idempotencyKey).join("|");
  useEffect(() => {
    if (!workspaceId || !briefs.length) return;
    for (const brief of briefs) {
      void studioApi
        .findJob(workspaceId, brief.job.idempotencyKey)
        .then((job) => job && follow(brief.n, job))
        .catch(() => undefined);
    }
    // keys stands in for briefs; follow is stable enough for a one-off recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, keys]);

  return {
    posts,
    billing,
    priceLabel,
    async start() {
      setBilling(null);
      // One at a time: a 402 on the first stops the rest before they're tried.
      for (const brief of briefs) {
        const state = posts[brief.n];
        if (state && state.status !== "idle") continue;
        if (!(await create(brief, attempts.current[brief.n] ?? 0))) break;
      }
    },
    async retry(n: number) {
      const brief = briefs.find((b) => b.n === n);
      if (!brief) return;
      attempts.current[n] = (attempts.current[n] ?? 0) + 1;
      await create(brief, attempts.current[n]);
    },
  };
}
