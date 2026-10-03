export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["state", "code", "error"]) {
    const value = input.get(key);
    if (value && value.length <= 2048) query.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: `/integrations/canva/callback?${query}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
