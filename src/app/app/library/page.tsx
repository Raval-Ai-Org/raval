import { redirect } from "next/navigation";

export default function LibraryRoute() {
  redirect("/app?library=1");
}
