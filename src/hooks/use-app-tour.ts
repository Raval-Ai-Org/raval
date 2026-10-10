"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Whether this person has been shown the app tour. It is per account
// (`profiles.app_tour_seen_at`), so a new person sees it once on any device;
// localStorage only saves the round trip on later visits.
//
// Anything short of a clear "not yet" counts as seen: a failed read, a missing
// row or a signed-out visitor must never bring the tour up again.

const cacheKey = (userId: string) => `tour:seen:${userId}`;

export function useAppTourSeen() {
  const [state, setState] = useState<{ ready: boolean; seen: boolean }>({
    ready: false,
    seen: true,
  });
  const [firstName, setFirstName] = useState<string | undefined>(undefined);
  const userId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const id = sess.session?.user.id ?? null;
      if (cancelled) return;
      if (!id) return setState({ ready: true, seen: true });
      userId.current = id;
      const meta = sess.session?.user.user_metadata as Record<string, unknown> | undefined;
      const fullName = meta?.full_name ?? meta?.name;
      if (typeof fullName === "string") setFirstName(fullName.trim().split(/\s+/)[0] || undefined);
      try {
        if (localStorage.getItem(cacheKey(id)) === "1") {
          return setState({ ready: true, seen: true });
        }
      } catch {
        /* storage unavailable: ask the server */
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("app_tour_seen_at")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const seen = Boolean(error) || !data || data.app_tour_seen_at !== null;
      if (seen) {
        try {
          localStorage.setItem(cacheKey(id), "1");
        } catch {
          /* ignore */
        }
      }
      setState({ ready: true, seen });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Called the moment the tour opens, so a refresh never shows it twice. */
  const markSeen = useCallback(() => {
    setState({ ready: true, seen: true });
    const id = userId.current;
    if (!id) return;
    try {
      localStorage.setItem(cacheKey(id), "1");
    } catch {
      /* ignore */
    }
    void supabase
      .from("profiles")
      .update({ app_tour_seen_at: new Date().toISOString() })
      .eq("id", id)
      .is("app_tour_seen_at", null)
      .then(() => undefined);
  }, []);

  return { ...state, firstName, markSeen };
}
