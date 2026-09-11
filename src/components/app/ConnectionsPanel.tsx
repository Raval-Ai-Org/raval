"use client";

import { emitAppEvent } from "@/lib/app-events";
import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";

export function ConnectionsPanel() {
  return <SocialAccountsSection variant="studio" onManage={() => emitAppEvent("open:settings")} />;
}
