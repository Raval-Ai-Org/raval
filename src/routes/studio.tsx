import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /studio → /app/social
 *
 * Legacy/alias route: the SDR Studio lives at /app/social under the
 * authenticated /app layout. Redirect so users (and old bookmarks) land
 * on the correct page.
 */
export const Route = createFileRoute("/studio")({
  beforeLoad: () => {
    throw redirect({ to: "/app/social" });
  },
});
