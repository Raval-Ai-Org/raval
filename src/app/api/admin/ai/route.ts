import { defineAdminRoute } from "@/server/admin/route";
import { getAiControls } from "@/server/admin/ai-controls.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.ai.controls",
  permission: "ai.read",
  handler: () => getAiControls(),
});
