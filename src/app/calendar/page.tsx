import { redirect } from "next/navigation";

export default function CalendarRedirect(): never {
  redirect("/workspace?calendar=1");
}