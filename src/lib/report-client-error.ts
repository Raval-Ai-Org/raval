// Error boundaries call this so browser crashes reach the same error tracker
// as server errors (POST /api/client-errors). Best-effort: it never throws and
// sends at most one report per error per page load.
const sent = new WeakSet<object>();

export function reportClientError(error: Error & { digest?: string }): void {
  if (typeof window === "undefined" || !error || sent.has(error)) return;
  sent.add(error);
  try {
    const body = JSON.stringify({
      message: String(error.message ?? "Unknown error").slice(0, 1000),
      digest: error.digest?.slice(0, 200),
      // Path only — query strings can carry share tokens.
      path: window.location.pathname.slice(0, 500),
      stack: error.stack?.slice(0, 4000),
    });
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never break the error page itself.
  }
}
