"use client";

// The findings of one scan, for the Overview (counts of what Mellox can fix).

import { useEffect, useState } from "react";
import { getScanFindings } from "@/lib/geo.functions";
import type { GeoFindingView } from "@/lib/geo/contracts";

export function useScanFindings(workspaceId: string, scanId: string) {
  const [findings, setFindings] = useState<GeoFindingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    getScanFindings({ data: { workspaceId, scanId } })
      .then((rows) => !cancelled && setFindings(rows))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load findings"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scanId, nonce]);
  return { findings, error, reload: () => setNonce((n) => n + 1) };
}
