import { isGoogleWebClientId } from "@/lib/google-auth-config";

export const dynamic = "force-dynamic";

/** Railway injects runtime variables after the Docker image has been built. */
export async function GET() {
  // Dynamic indexing prevents Next from freezing NEXT_PUBLIC_* at build time.
  // Never fall back to the Analytics connector's separate OAuth client.
  const names = ["GOOGLE_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_CLIENT_ID"];
  const clientId = names.map((name) => process.env[name]?.trim()).find(Boolean);
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!isGoogleWebClientId(clientId)) {
    return Response.json({ error: "GOOGLE_SIGN_IN_NOT_CONFIGURED" }, { status: 503, headers });
  }
  return Response.json({ clientId }, { headers });
}
