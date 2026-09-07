"use client";

import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";

export function ConnectionsPanel() {
  return (
    <SocialAccountsSection
      variant="studio"
      onManage={() => window.dispatchEvent(new CustomEvent("open:settings"))}
    />
  );
}
