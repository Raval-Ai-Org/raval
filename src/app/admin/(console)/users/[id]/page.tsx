import { notFound } from "next/navigation";
import { UserDetailScreen } from "@/components/admin/console/UserDetailScreen";
import { isUuid } from "@/lib/admin/ids";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <UserDetailScreen id={id} />;
}
