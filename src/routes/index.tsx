import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        throw redirect({ to: "/app" });
      }
    } catch (e) {
      // rethrow router redirects; swallow session errors and fall through to /login
      if (e && typeof e === "object" && "isRedirect" in (e as any)) throw e;
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
