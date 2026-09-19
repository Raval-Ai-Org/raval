"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";

export function LandingGate() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) router.replace("/projects");
    })();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) router.replace("/projects");
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
