import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/seo")({
  beforeLoad: () => { throw redirect({ to: "/app/analytics", search: { tab: "organic" } }); },
});
