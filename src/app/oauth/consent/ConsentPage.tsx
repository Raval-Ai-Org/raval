"use client";

// The consent step of signing an AI assistant in to Mellox. The request is
// identified by `authorization_id`; the signed-in person's own session reads
// it and approves or denies it. Nothing is granted by opening this page.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/page-loader";
import { supabase } from "@/integrations/supabase/client";

type View =
  | { kind: "loading" }
  | { kind: "ask"; app: string; host: string; account: string }
  | { kind: "error"; message: string };

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "";
  }
}

export function ConsentPage() {
  const authorizationId = useSearchParams().get("authorization_id");
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authorizationId) {
        setView({
          kind: "error",
          message: "This link isn't complete. Start again from your assistant.",
        });
        return;
      }
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        setView({
          kind: "error",
          message: "This request has expired. Start again from your assistant.",
        });
        return;
      }
      // Already agreed earlier: go straight back.
      if (!("authorization_id" in data)) {
        window.location.replace(data.redirect_url);
        return;
      }
      setView({
        kind: "ask",
        app: data.client.name || "An assistant",
        host: hostOf(data.redirect_uri),
        account: data.user.email,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);

  const decide = async (allow: boolean) => {
    if (!authorizationId) return;
    setBusy(allow ? "allow" : "deny");
    const call = allow
      ? supabase.auth.oauth.approveAuthorization
      : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await call.call(supabase.auth.oauth, authorizationId, {
      skipBrowserRedirect: true,
    });
    if (error || !data?.redirect_url) {
      setBusy(null);
      setView({ kind: "error", message: "That didn't work. Start again from your assistant." });
      return;
    }
    window.location.assign(data.redirect_url);
  };

  if (view.kind === "loading") return <PageLoader label="Loading…" />;

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="ds-tile w-full max-w-[420px] p-6 sm:p-7">
        <Logo />
        {view.kind === "error" ? (
          <>
            <h1 className="mt-6 text-[20px] font-semibold text-foreground">Can&apos;t connect</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">{view.message}</p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[20px] font-semibold text-foreground">
              Let {view.app} use Mellox?
            </h1>
            <p className="mt-2 text-[14px] text-muted-foreground">
              It will act as you ({view.account}) in the workspaces where an admin has turned on AI
              assistants. It can never do more than you can.
            </p>
            <ul className="mt-4 space-y-1.5 text-[13.5px] text-foreground">
              <li>See your workspaces, content, plans and results</li>
              <li>Create, edit, approve, schedule and post, where changes are allowed</li>
            </ul>
            {view.host && (
              <p className="mt-4 text-[12.5px] text-muted-foreground">
                You&apos;ll go back to {view.host}.
              </p>
            )}
            <div className="mt-6 flex gap-2">
              <Button
                className="flex-1"
                loading={busy === "allow"}
                disabled={busy !== null}
                onClick={() => decide(true)}
              >
                Allow
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                loading={busy === "deny"}
                disabled={busy !== null}
                onClick={() => decide(false)}
              >
                Don&apos;t allow
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
