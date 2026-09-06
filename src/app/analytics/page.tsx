import { redirect } from "next/navigation";

export default function AnalyticsRedirect(): never {
  redirect("/workspace?tab=overview");
}
