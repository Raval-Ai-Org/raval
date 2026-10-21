import { notFound } from "next/navigation";
import { SupportViewScreen } from "@/components/admin/console/SupportViewScreen";
import { isUuid } from "@/lib/admin/ids";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <SupportViewScreen sessionId={id} />;
}
