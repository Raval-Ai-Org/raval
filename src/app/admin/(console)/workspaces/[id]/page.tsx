import { notFound } from "next/navigation";
import { WorkspaceDetailScreen } from "@/components/admin/console/WorkspaceDetailScreen";
import { isUuid } from "@/lib/admin/ids";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <WorkspaceDetailScreen id={id} />;
}
