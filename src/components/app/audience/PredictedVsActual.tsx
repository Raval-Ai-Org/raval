"use client";

// Analytics: what Mellox expected of scored posts against what really
// happened. Nothing is shown until at least one real result exists.
import { useQuery } from "@tanstack/react-query";
import { getAudience } from "@/lib/audience.functions";
import { Accuracy } from "./AudienceScreen";
import { audienceKeys, useAudienceEnabled } from "./hooks";

export function PredictedVsActual({ workspaceId }: { workspaceId: string }) {
  const enabled = useAudienceEnabled(workspaceId);
  const { data } = useQuery({
    queryKey: audienceKeys.view(workspaceId),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => getAudience({ data: { workspaceId } }),
  });
  if (!data || data.accuracy.measured === 0) return null;
  return (
    <div>
      <Accuracy accuracy={data.accuracy} />
    </div>
  );
}
