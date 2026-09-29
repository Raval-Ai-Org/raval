export const dynamic = "force-dynamic";

export function POST(): Response {
  return Response.json({ error: "SocialAPI integration is retired" }, { status: 410 });
}
