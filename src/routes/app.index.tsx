import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SitePreview } from "@/components/app/SitePreview";
import { GeoAeoPanel } from "@/components/app/GeoAeoPanel";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/app/")({
  component: CommandCenter,
  head: () => pageHead({
    title: "Studio · Raval AI",
    description: "Your Marketing Intelligence Layer — chat with Ravi to plan, create, optimize and grow content, SEO/AEO/GEO and social for the active brand.",
    path: "/app",
    noindex: true,
  }),
});

function CommandCenter() {
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
        // Stale selection — fall through to most recent workspace
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

