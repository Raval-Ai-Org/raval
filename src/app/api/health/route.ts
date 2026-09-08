import { NextResponse } from "next/server";
import { getKieConfigStatus } from "@/lib/kie-gateway.server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", kie: getKieConfigStatus() });
}
