import type { LucideIcon } from "@/components/brand/icons";
import { MessageSquare } from "@/components/ui/gemini-icons";

export type WorkspaceModule = {
  to: string;
  label: string;
  icon: LucideIcon;
  slug: string;
  exact?: boolean;
};

export const workspaceModules: WorkspaceModule[] = [
  { to: "/app", label: "Chat", icon: MessageSquare, slug: "home", exact: true },
];
