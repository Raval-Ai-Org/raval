// /r/<code> — a friend's invite link. Remembers who invited this visitor for
// 30 days (httpOnly cookie) and sends them to sign up. The reward is decided
// later on the server (src/server/billing/lifecycle.server.ts), never here.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const target = new URL("/signup", request.url);
  const response = NextResponse.redirect(target, 302);
  if (/^[A-Za-z0-9]{6,20}$/.test(code)) {
    response.cookies.set("mellox_ref", code.toUpperCase(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 86_400,
    });
  }
  return response;
}
