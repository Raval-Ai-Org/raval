import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/seo")({
  // Private studio deep-link — must never be indexable. The redirect lands on
  // /app (noindex), so pin the same noindex + canonical here in case a crawler
  // or the redirect chain reads this route's shell directly.
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
    links: [{ rel: "canonical", href: "https://raval6.lovable.app/app" }],
  }),
  beforeLoad: () => { throw redirect({ to: "/app/analytics", search: { tab: "organic" } }); },
});
