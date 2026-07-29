import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/content")({
  beforeLoad: () => { throw redirect({ to: "/app/analytics", search: { tab: "content" } }); },
});
