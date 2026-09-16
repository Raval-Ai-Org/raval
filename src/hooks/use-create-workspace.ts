"use client";

// Create a workspace safely. One idempotency key per create attempt means a
// double click, a retry after a timeout, a refresh-and-resubmit or React
// Strict Mode can never make two workspaces; the database also returns the
// owner's existing workspace for the same brand domain instead of a copy.

import { useCallback, useRef, useState } from "react";
import { createWorkspace } from "@/lib/workspaces.functions";
import { useInvalidateWorkspaces } from "@/hooks/use-workspaces";

export type CreateWorkspaceOutcome = {
  id: string;
  created: boolean;
  domain: string | null;
  name: string;
};

const PENDING_KEY = "workspace:create-key";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Key for this attempt, kept across a refresh so a resubmit replays it. */
function attemptKey(signature: string): string {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const saved = raw ? (JSON.parse(raw) as { signature: string; key: string }) : null;
    if (saved?.signature === signature) return saved.key;
    const key = newKey();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ signature, key }));
    return key;
  } catch {
    return newKey();
  }
}

function clearAttempt() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function useCreateWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  const [pending, setPending] = useState(false);
  const inFlight = useRef<Promise<CreateWorkspaceOutcome> | null>(null);

  const create = useCallback(
    (input: { name: string; websiteUrl: string | null }): Promise<CreateWorkspaceOutcome> => {
      // A second submit while the first is running joins it.
      if (inFlight.current) return inFlight.current;
      const signature = `${input.name.trim().toLowerCase()}|${(input.websiteUrl ?? "").toLowerCase()}`;
      const idempotencyKey = attemptKey(signature);
      setPending(true);
      const run = createWorkspace({
        data: { name: input.name, websiteUrl: input.websiteUrl, idempotencyKey },
      })
        .then((result) => {
          clearAttempt();
          void invalidate();
          return result as CreateWorkspaceOutcome;
        })
        .finally(() => {
          inFlight.current = null;
          setPending(false);
        });
      inFlight.current = run;
      return run;
    },
    [invalidate],
  );

  return { create, pending };
}
