import { Suspense } from "react";
import { CustomersScreen } from "@/components/admin/console/CustomersScreen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CustomersScreen />
    </Suspense>
  );
}
