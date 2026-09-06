import { redirect } from "next/navigation";

export default function ContentRedirect(): never {
  redirect("/workspace?tab=content");
}
