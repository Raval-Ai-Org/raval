"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";

/**
 * The root URL is a gate, not a page: signed-in visitors land in the
 * workspace, everyone else goes to sign-in. The session lives in
 * localStorage, so the decision has to happen in the browser.
 */
export function LandingGate() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          router.replace("/app");
          return;
        }
      } catch {
        // Swallow session errors and fall through to /login.
      }
      if (!cancelled) router.replace("/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
