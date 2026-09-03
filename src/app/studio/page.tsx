import { redirect } from "next/navigation";

/**
 * /studio → /app/social
 *
 * Legacy/alias route: the SDR Studio lives at /app/social under the
 * authenticated /app layout. Redirect so users (and old bookmarks) land
 * on the correct page.
 */
export default function StudioRedirect(): never {
  redirect("/app/social");
}
