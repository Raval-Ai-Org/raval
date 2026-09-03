"use client";

// Former /app/ index content. It is kept as a component because the /app route
// shell never mounted a child outlet, so this was already unreachable through
// routing before the move to Next — nothing rendered it then, nothing does now.
import { useEffect, useState } from "react";
import { SitePreview } from "@/components/app/SitePreview";
import { GeoAeoPanel } from "@/components/app/GeoAeoPanel";
import { supabase } from "@/integrations/supabase/client";

export function CommandCenter() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const selectedId =
        typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
      if (selectedId) {
        const { data } = await supabase
          .from("workspaces")
          .select("id")
          .eq("id", selectedId)
          .maybeSingle();
        if (cancelled) return;
        if (data?.id) {
          setWorkspaceId(data.id);
          return;
        }
        // Stale selection â€” fall through to most recent workspace
        localStorage.removeItem("workspace:selected");
      }
      const { data } = await supabase
        .from("workspaces")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setWorkspaceId(data?.id ?? null);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative px-3 pb-16 sm:px-5">
      <SitePreview workspaceId={workspaceId} />
      <div className="hidden lg:block">
        <GeoAeoPanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}
