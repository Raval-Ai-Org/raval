import { useEffect, useState } from "react";
import { getActiveWorkspaceId } from "@/lib/authed-fetch";
import { getSdrStatus, type SdrStatus } from "@/lib/sdr.functions";

// Per-workspace cache so every card in a list doesn't refetch the status.
const cache = new Map<string, Promise<SdrStatus>>();

/**
 * Distribution status for a workspace (defaults to the active one). `null`
 * while loading. Publish/Schedule controls render only when
 * `status.enabled && status.canPublish` — otherwise they would 503 or 403.
 */
export function useSdrStatus(workspaceId?: string | null): SdrStatus | null {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  const [status, setStatus] = useState<SdrStatus | null>(null);

  useEffect(() => {
    if (!wsId) {
      setStatus(null);
      return;
    }
    let alive = true;
    let pending = cache.get(wsId);
    if (!pending) {
      pending = getSdrStatus(wsId).catch(() => ({ enabled: false, canPublish: false, role: null }));
      cache.set(wsId, pending);
      // Re-check after a minute: the flag or the caller's role can change.
      setTimeout(() => cache.delete(wsId), 60_000);
    }
    void pending.then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [wsId]);

  return status;
}

export function canDistribute(status: SdrStatus | null): boolean {
  return Boolean(status?.enabled && status.canPublish);
}
